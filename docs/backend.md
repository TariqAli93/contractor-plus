# Backend Structure

## Architecture

Modular Monolith

---

## Structure

modules/
├─ auth/
├─ users/
├─ rbac/
├─ customers/
├─ materials/
├─ templates/
├─ contracts/
├─ projects/
├─ costs/
├─ payments/
├─ progress/
├─ reports/
├─ audit/
├─ tunnel/
└─ settings/

---

## Tech

- Node.js
- Express.js
- TypeScript
- PostgreSQL
- Prisma
- Zod
- JWT

---

## API Design

REST API

Example:

GET /projects
POST /contracts
POST /projects/:id/costs
GET /reports/profit-loss

---

## Audit Logging

كل عملية:

- create
- update
- delete

تدخل داخل audit_logs.

---

## Validation

Zod validation لكل:

- body
- params
- query

---

## Authentication

JWT Access Token
Refresh Token

---

## Authorization

RBAC

Roles:

- Owner
- Admin
- Accountant
- Engineer
- Viewer
