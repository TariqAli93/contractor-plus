# Database

## Main Tables

### customers

- id
- name
- phone
- address
- notes

---

### contracts

- id
- customer_id
- template_id
- building_area
- floors
- meter_price
- total_price
- expected_profit_margin
- status

---

### contract_items

- id
- contract_id
- material_id
- quantity
- unit
- estimated_price

---

### projects

- id
- contract_id
- name
- start_date
- delivery_date
- progress_percentage
- status

---

### project_costs

- id
- project_id
- category
- amount
- notes
- date

---

### payments

- id
- project_id
- amount
- due_date
- payment_date
- status

---

### construction_steps

- id
- project_id
- name
- percentage
- status

---

### building_templates

- id
- name
- estimated_duration
- suggested_profit_margin

---

### building_template_items

- id
- template_id
- material_id
- quantity_formula

---

### audit_logs

- id
- user_id
- action
- entity
- entity_id
- old_values
- new_values
- created_at
