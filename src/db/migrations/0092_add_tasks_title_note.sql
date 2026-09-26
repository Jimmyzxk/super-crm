-- 0092_add_tasks_title_note.sql
-- KB 一键生成任务：title/note 落库，正式迁移替代运行时 DDL
-- 不可逆说明：新增可空列，无数据回填；回滚 drop column if exists。
-- 回滚：alter table tasks drop column if exists title; alter table tasks drop column if exists note;

alter table tasks add column if not exists title text;
alter table tasks add column if not exists note text;
