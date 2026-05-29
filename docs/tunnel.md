# Tunnel System

## الهدف

السماح بالوصول الخارجي للنظام
بدون إعدادات شبكات معقدة.

---

## Technology

- Cloudflare Tunnel
- cloudflared
- codel-management-api

---

## Tunnel Actions

- enable
- disable
- status

---

## Flow

Desktop App
→ Backend
→ codel-management-api
→ Cloudflare API

---

## Security

Cloudflare Tokens
تبقى داخل:
codel-management-api

ولا تحفظ داخل تطبيق العميل.

---

## Local Binary

tools/
└─ cloudflared/
└─ cloudflared.exe
