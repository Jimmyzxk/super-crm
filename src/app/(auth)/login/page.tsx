"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/core/auth/actions";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <form
        className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200/80 bg-white p-8 shadow-xl"
        action={async () => {
          setError("");
          const result = await login({ email, password });
          if (result.ok) {
            router.push("/today");
            router.refresh();
          } else {
            setError(result.message);
          }
        }}
      >
        <div className="border-b border-slate-100 pb-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-xs">
              <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-950">Super CRM</h1>
            <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">PRO</span>
          </div>
          <p className="text-xs text-slate-500">企业级数智化销售管理与全生命周期营收中枢</p>
        </div>
        <label className="block text-xs font-medium text-slate-700">
          电子邮箱
          <input
            autoComplete="username"
            className="mt-1.5 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            placeholder="name@company.com"
          />
        </label>
        <label className="block text-xs font-medium text-slate-700">
          登录密码
          <input
            autoComplete="current-password"
            className="mt-1.5 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error && <p role="alert" className="text-xs text-red-600 font-medium">{error}</p>}
        <button className="inline-flex h-9 w-full items-center justify-center rounded-md bg-slate-900 px-4 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 transition">
          登录系统
        </button>
      </form>
    </main>
  );
}
