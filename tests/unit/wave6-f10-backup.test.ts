import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * F10 备份健壮 —— 行为级测试（真跑脚本、真产出备份文件、真 gunzip 校验）
 *
 * 原实现是用 readFileSync 读 scripts/backup-db.sh 做 toContain 断言，外部审计点名不可
 * 作为风险关闭证据。这里改为把脚本复制到隔离沙箱目录、注入一个可控的假 `docker`
 * （模拟 pg_dump 输出 / 失败），真实执行脚本并断言**可观测产物**：
 * 产物可 gunzip、内容含预期表、原子更名后无临时文件残留、失败时非零退出且不产正式备份、
 * 20 小时补跑守卫按预期跳过。
 *
 * 沙箱化同时保证测试不会碰到开发库 crm-postgres，也不会污染仓库 backups/ 目录。
 */

const run = promisify(execFile);
const FAKE_DUMP = [
  "-- PostgreSQL database dump",
  "CREATE TABLE public.tenants (id uuid);",
  "CREATE TABLE public.leads (id uuid);",
  "CREATE TABLE public.customers (id uuid);",
  "CREATE TABLE public.opportunities (id uuid);",
  "COPY public.leads (id) FROM stdin;",
  "\\.",
].join("\n");

let sandbox: string;
let scriptPath: string;
let backupsDir: string;
let binDir: string;

function writeFakeDocker(body: string) {
  const p = path.join(binDir, "docker");
  fs.writeFileSync(p, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
}

function listBackups() {
  return fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir) : [];
}

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "crm-backup-test-"));
  const scriptsDir = path.join(sandbox, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  binDir = path.join(sandbox, "fakebin");
  fs.mkdirSync(binDir, { recursive: true });
  // 脚本把备份写到 <SCRIPT_DIR>/../backups
  backupsDir = path.join(sandbox, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  scriptPath = path.join(scriptsDir, "backup-db.sh");
  // 沙箱副本：仅把测试替身目录插到脚本自解析 PATH 的最前面（真实 docker 在
  // /usr/local/bin 会被脚本自身 prepend 的固定路径优先命中，无法用替身覆盖）。
  // 除 PATH 之外脚本内容逐字保留，被测逻辑（pg_dump 管道 / gzip -t 校验 / 原子更名 /
  // 轮转 / 20 小时补跑守卫）完全是仓库里的真实实现。
  const original = fs.readFileSync(path.join(process.cwd(), "scripts", "backup-db.sh"), "utf8");
  const patched = original.replace('export PATH="/usr/local/bin:', `export PATH="${binDir}:/usr/local/bin:`);
  expect(patched).not.toBe(original);
  fs.writeFileSync(scriptPath, patched, { mode: 0o755 });
  fs.chmodSync(scriptPath, 0o755);
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

async function runScript() {
  try {
    const { stdout, stderr } = await run("bash", [scriptPath], {
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("F10 备份脚本健壮（行为级：真跑脚本 + 真校验产物）", () => {
  it("正常备份：产物可 gunzip 且包含预期表，原子更名后无临时文件残留", async () => {
    writeFakeDocker(`cat <<'DUMP_EOF'\n${FAKE_DUMP}\nDUMP_EOF`);

    const res = await runScript();
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/Backup completed successfully/);

    const files = listBackups();
    const formal = files.filter((f) => /^salescrm_.*\.sql\.gz$/.test(f));
    expect(formal).toHaveLength(1);
    // 原子更名：临时文件不得残留
    expect(files.filter((f) => f.startsWith(".tmp_"))).toHaveLength(0);

    const gzPath = path.join(backupsDir, formal[0]);
    // 真 gunzip 校验完整性并读取内容
    const { stdout: dumped } = await run("gunzip", ["-c", gzPath]);
    expect(dumped).toContain("CREATE TABLE public.leads");
    expect(dumped).toContain("CREATE TABLE public.opportunities");
    expect(dumped).toContain("CREATE TABLE public.tenants");
  });

  it("pg_dump 失败：非零退出、不产生正式备份、临时文件被清理", async () => {
    fs.rmSync(backupsDir, { recursive: true, force: true });
    fs.mkdirSync(backupsDir, { recursive: true });
    writeFakeDocker('echo "pg_dump: connection failed" >&2\nexit 1');

    const res = await runScript();
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/ERROR/);
    expect(listBackups().filter((f) => /^salescrm_.*\.sql\.gz$/.test(f))).toHaveLength(0);
    expect(listBackups().filter((f) => f.startsWith(".tmp_"))).toHaveLength(0);
  });

  it("管道完整性：正式产物必须通过 gzip -t 校验", async () => {
    fs.rmSync(backupsDir, { recursive: true, force: true });
    fs.mkdirSync(backupsDir, { recursive: true });
    writeFakeDocker(`cat <<'DUMP_EOF'\n${FAKE_DUMP}\nDUMP_EOF`);

    const res = await runScript();
    expect(res.code).toBe(0);
    const formal = listBackups().filter((f) => /^salescrm_.*\.sql\.gz$/.test(f));
    expect(formal).toHaveLength(1);
    // 脚本在更名前已自检，这里独立复核产物确实可解压（双保险）
    await expect(run("gzip", ["-t", path.join(backupsDir, formal[0])])).resolves.toBeTruthy();
  });

  it("pg_dump 半途失败（已输出部分内容后非零退出）：pipefail 拦截，残缺内容不得被提升为正式备份", async () => {
    fs.rmSync(backupsDir, { recursive: true, force: true });
    fs.mkdirSync(backupsDir, { recursive: true });
    writeFakeDocker(`echo "-- partial dump"\ncat <<'DUMP_EOF' >/dev/null\n${FAKE_DUMP}\nDUMP_EOF\nexit 3`);

    const res = await runScript();
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/ERROR/);
    expect(listBackups().filter((f) => /^salescrm_.*\.sql\.gz$/.test(f))).toHaveLength(0);
    expect(listBackups().filter((f) => f.startsWith(".tmp_"))).toHaveLength(0);
  });

  it("补跑守卫：20 小时内已有有效备份时跳过重复备份（不覆盖既有产物）", async () => {
    fs.rmSync(backupsDir, { recursive: true, force: true });
    fs.mkdirSync(backupsDir, { recursive: true });
    writeFakeDocker(`cat <<'DUMP_EOF'\n${FAKE_DUMP}\nDUMP_EOF`);

    const first = await runScript();
    expect(first.code).toBe(0);
    const afterFirst = listBackups().filter((f) => /^salescrm_.*\.sql\.gz$/.test(f));
    expect(afterFirst).toHaveLength(1);

    // 第二次运行：假 docker 若被调用会直接失败，从而证明"确实没再跑 pg_dump"
    writeFakeDocker("exit 1");
    const second = await runScript();
    expect(second.code).toBe(0);
    expect(second.stdout).toMatch(/SKIP:/);
    const afterSecond = listBackups().filter((f) => /^salescrm_.*\.sql\.gz$/.test(f));
    expect(afterSecond).toHaveLength(1);
  });
});
