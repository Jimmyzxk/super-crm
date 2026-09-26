/**
 * plugin-kit 客户端安全面：插件 UI 组件可用的纯工具再导出。
 *
 * 只允许转发零业务逻辑、无服务端依赖（db/session）的叶子工具；
 * 需要数据能力时走 server.ts。维持"插件不直接 import core"的分层约束。
 */
export {
  dateInputValue,
  localDateValue,
  parseLocalDate,
  parseLocalDateTime,
  startOfLocalDay,
  formatDateOnly,
  getShanghaiDateString,
  addShanghaiDays,
} from "@/core/shared/date";
