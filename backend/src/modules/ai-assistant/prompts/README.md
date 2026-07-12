# prompts/

قوالب رسائل النموذج (system/user builders) لموديول `ai-assistant`.

- المرحلة 2 تضيف: `report-narrative.<reportType>.ts` — قالب لكل تقرير
  (`cash-flow`, `delayed-projects`, `overdue-payments`, `project-profitability`).
- المرحلة 3 تضيف: prompt استعلام اللغة الطبيعية المقيّد (JSON فقط).

القاعدة: القوالب تستقبل DTOs مُطبّعة من `ai-context.service` فقط — لا نصوص عقود
كاملة ولا حقول حساسة.
