# UI & Design System Rules

1. **Zero Emoji Tolerance (绝对禁止 Emoji 图标)**:
   - 严禁在任何前端页面、弹窗、提示信息或表格中使用 Emoji 图标（如 🎉, ✨, 📞, ✉️, ⚠️ 等）。必须使用专业的 Heroicons SVG 矢量图标或纯文本。
2. **Header CTA Buttons**:
   - Primary: `<Button variant="primary" size="md" leftIcon={<svg className="w-4 h-4" ...><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>}>Label</Button>`
   - Secondary: `<Button variant="secondary" size="md">Secondary Action</Button>`
3. **Table Action Buttons**:
   - Secondary XS button: `<Button variant="secondary" size="xs">编辑</Button>`
   - Concise 2-character action verbs (`编辑`, `查看`, `删除`).
