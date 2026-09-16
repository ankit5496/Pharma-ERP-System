## Appendix A — every table, every column

Generated from `packages/database/prisma/schema.prisma`. Column names are the
PostgreSQL names; the Prisma model name is given beside each table because the
application code uses the camelCase form (`stockLot`, not `stock_lots`).

### Platform and tenancy

#### `tenants` — Prisma model `Tenant`

| column                      | type           | notes                  |
| --------------------------- | -------------- | ---------------------- |
| `id`                        | Uuid           | default uuid(), PK     |
| `slug`                      | VarChar(63)    | unique                 |
| `name`                      | VarChar(255)   |                        |
| `status`                    | TenantStatus   | default TRIAL          |
| `drug_licence_number`       | VarChar(64)    | nullable               |
| `gstin`                     | VarChar(15)    | nullable               |
| `timezone`                  | VarChar(64)    | default "Asia/Kolkata" |
| `invoice_tolerance_percent` | Decimal(5, 2)  | default 2.00           |
| `licence_alert_lead_days`   | Int            | default 60             |
| `auto_requisition_enabled`  | Boolean        | default true           |
| `batch_number_prefix`       | VarChar(8)     | default "B"            |
| `created_at`                | Timestamptz(6) | default now()          |
| `updated_at`                | Timestamptz(6) |                        |
| `deleted_at`                | Timestamptz(6) | nullable               |

- `@@index([deletedAt])`

#### `users` — Prisma model `User`

| column                  | type           | notes              |
| ----------------------- | -------------- | ------------------ |
| `id`                    | Uuid           | default uuid(), PK |
| `tenant_id`             | Uuid           |                    |
| `email`                 | VarChar(320)   | unique             |
| `full_name`             | VarChar(255)   |                    |
| `phone`                 | VarChar(32)    | nullable           |
| `role`                  | UserRole       |                    |
| `status`                | UserStatus     | default INVITED    |
| `password_hash`         | VarChar(255)   | nullable           |
| `password_set_at`       | Timestamptz(6) | nullable           |
| `must_change_password`  | Boolean        | default true       |
| `failed_login_attempts` | Int            | default 0          |
| `locked_until`          | Timestamptz(6) | nullable           |
| `last_login_at`         | Timestamptz(6) | nullable           |
| `created_at`            | Timestamptz(6) | default now()      |
| `updated_at`            | Timestamptz(6) |                    |
| `deleted_at`            | Timestamptz(6) | nullable           |

- `@@unique([tenantId, email])`
- `@@index([tenantId, role])`
- `@@index([tenantId, deletedAt])`

#### `audit_logs` — Prisma model `AuditLog`

| column        | type           | notes                       |
| ------------- | -------------- | --------------------------- |
| `id`          | BigInt         | default autoincrement(), PK |
| `tenant_id`   | Uuid           |                             |
| `entity_type` | VarChar(64)    |                             |
| `entity_id`   | VarChar(64)    |                             |
| `action`      | AuditAction    |                             |
| `user_id`     | Uuid           | nullable                    |
| `before_json` | Json           | nullable                    |
| `after_json`  | Json           | nullable                    |
| `request_id`  | VarChar(64)    | nullable                    |
| `ip_address`  | Inet           | nullable                    |
| `user_agent`  | VarChar(512)   | nullable                    |
| `created_at`  | Timestamptz(6) | default now()               |

- `@@index([tenantId, entityType, entityId, createdAt])`
- `@@index([tenantId, userId, createdAt])`

#### `platform_users` — Prisma model `PlatformUser`

| column                  | type               | notes              |
| ----------------------- | ------------------ | ------------------ |
| `id`                    | Uuid               | default uuid(), PK |
| `email`                 | VarChar(320)       | unique             |
| `full_name`             | VarChar(255)       |                    |
| `phone`                 | VarChar(32)        | nullable           |
| `status`                | PlatformUserStatus | default ACTIVE     |
| `password_hash`         | VarChar(255)       | nullable           |
| `password_set_at`       | Timestamptz(6)     | nullable           |
| `must_change_password`  | Boolean            | default true       |
| `failed_login_attempts` | Int                | default 0          |
| `locked_until`          | Timestamptz(6)     | nullable           |
| `last_login_at`         | Timestamptz(6)     | nullable           |
| `created_at`            | Timestamptz(6)     | default now()      |
| `updated_at`            | Timestamptz(6)     |                    |
| `deleted_at`            | Timestamptz(6)     | nullable           |

- `@@index([deletedAt])`

#### `platform_audit_logs` — Prisma model `PlatformAuditLog`

| column             | type           | notes                       |
| ------------------ | -------------- | --------------------------- |
| `id`               | BigInt         | default autoincrement(), PK |
| `platform_user_id` | Uuid           | nullable                    |
| `action`           | VarChar(64)    |                             |
| `entity_type`      | VarChar(64)    |                             |
| `entity_id`        | VarChar(64)    | nullable                    |
| `details_json`     | Json           | nullable                    |
| `request_id`       | VarChar(64)    | nullable                    |
| `ip_address`       | Inet           | nullable                    |
| `user_agent`       | VarChar(512)   | nullable                    |
| `created_at`       | Timestamptz(6) | default now()               |

- `@@index([createdAt])`
- `@@index([platformUserId, createdAt])`

#### `document_sequences` — Prisma model `DocumentSequence`

| column       | type        | notes              |
| ------------ | ----------- | ------------------ |
| `id`         | Uuid        | default uuid(), PK |
| `tenant_id`  | Uuid        |                    |
| `doc_type`   | VarChar(16) |                    |
| `year`       | Int         |                    |
| `next_value` | Int         | default 1          |

- `@@unique([tenantId, docType, year])`

### Master data

#### `items` — Prisma model `Item`

| column                    | type                   | notes              |
| ------------------------- | ---------------------- | ------------------ |
| `id`                      | Uuid                   | default uuid(), PK |
| `tenant_id`               | Uuid                   |                    |
| `code`                    | VarChar(64)            |                    |
| `name`                    | VarChar(255)           |                    |
| `type`                    | ItemType               |                    |
| `uom`                     | VarChar(16)            |                    |
| `shelf_life_months`       | Int                    | nullable           |
| `hsn_code`                | VarChar(16)            | nullable           |
| `created_at`              | Timestamptz(6)         | default now()      |
| `updated_at`              | Timestamptz(6)         |                    |
| `deleted_at`              | Timestamptz(6)         | nullable           |
| `brand_name`              | VarChar(255)           | nullable           |
| `generic_name`            | VarChar(512)           | nullable           |
| `schedule_classification` | ScheduleClassification | default NONE       |
| `gst_rate`                | Decimal(5, 2)          | nullable           |
| `mrp`                     | Decimal(12, 2)         | nullable           |
| `dpco_ceiling`            | Boolean                | default false      |
| `storage_conditions`      | VarChar(255)           | nullable           |
| `reorder_level`           | Decimal(14, 3)         | nullable           |
| `reorder_quantity`        | Decimal(14, 3)         | nullable           |
| `requires_batch_tracking` | Boolean                | default true       |
| `notes`                   | VarChar(1000)          | nullable           |

- `@@unique([tenantId, code])`
- `@@index([tenantId, type, deletedAt])`

#### `parties` — Prisma model `Party`

| column                  | type           | notes              |
| ----------------------- | -------------- | ------------------ |
| `id`                    | Uuid           | default uuid(), PK |
| `tenant_id`             | Uuid           |                    |
| `code`                  | VarChar(64)    |                    |
| `name`                  | VarChar(255)   |                    |
| `party_type`            | PartyType      | default VENDOR     |
| `gstin`                 | VarChar(15)    | nullable           |
| `drug_licence_number`   | VarChar(64)    | nullable           |
| `email`                 | VarChar(320)   | nullable           |
| `phone`                 | VarChar(32)    | nullable           |
| `address`               | VarChar(1000)  | nullable           |
| `payment_terms_days`    | Int            | default 30         |
| `status`                | PartyStatus    | default ACTIVE     |
| `drug_licence_valid_to` | Date           | nullable           |
| `credit_limit`          | Decimal(14, 2) | nullable           |
| `credit_period_days`    | Int            | nullable           |
| `created_at`            | Timestamptz(6) | default now()      |
| `updated_at`            | Timestamptz(6) |                    |
| `deleted_at`            | Timestamptz(6) | nullable           |

- `@@unique([tenantId, code])`
- `@@index([tenantId, partyType, deletedAt])`
- `@@index([tenantId, drugLicenceValidTo])`

#### `boms` — Prisma model `Bom`

| column            | type           | notes              |
| ----------------- | -------------- | ------------------ |
| `id`              | Uuid           | default uuid(), PK |
| `tenant_id`       | Uuid           |                    |
| `product_id`      | Uuid           |                    |
| `version`         | Int            |                    |
| `output_quantity` | Decimal(14, 3) |                    |
| `instructions`    | String         | nullable           |
| `is_active`       | Boolean        | default false      |
| `effective_from`  | Date           | default now()      |
| `created_at`      | Timestamptz(6) | default now()      |
| `updated_at`      | Timestamptz(6) |                    |
| `deleted_at`      | Timestamptz(6) | nullable           |

- `@@unique([tenantId, productId, version])`
- `@@index([tenantId, deletedAt])`

#### `bom_lines` — Prisma model `BomLine`

| column         | type           | notes              |
| -------------- | -------------- | ------------------ |
| `id`           | Uuid           | default uuid(), PK |
| `tenant_id`    | Uuid           |                    |
| `bom_id`       | Uuid           |                    |
| `item_id`      | Uuid           |                    |
| `quantity_per` | Decimal(14, 3) |                    |
| `notes`        | VarChar(255)   | nullable           |

- `@@unique([bomId, itemId])`

#### `licences` — Prisma model `Licence`

| column              | type           | notes              |
| ------------------- | -------------- | ------------------ |
| `id`                | Uuid           | default uuid(), PK |
| `tenant_id`         | Uuid           |                    |
| `licence_type`      | LicenceType    |                    |
| `licence_number`    | VarChar(64)    |                    |
| `issuing_authority` | VarChar(255)   |                    |
| `issued_on`         | Date           | nullable           |
| `expiry_date`       | Date           |                    |
| `notes`             | VarChar(1000)  | nullable           |
| `created_at`        | Timestamptz(6) | default now()      |
| `updated_at`        | Timestamptz(6) |                    |
| `deleted_at`        | Timestamptz(6) | nullable           |

- `@@unique([tenantId, licenceType, licenceNumber])`
- `@@index([tenantId, expiryDate, deletedAt])`

#### `job_work_agreements` — Prisma model `JobWorkAgreement`

| column                   | type                | notes              |
| ------------------------ | ------------------- | ------------------ |
| `id`                     | Uuid                | default uuid(), PK |
| `tenant_id`              | Uuid                |                    |
| `principal_id`           | Uuid                |                    |
| `agreement_reference`    | VarChar(64)         | nullable           |
| `billing_model`          | BillingModel        |                    |
| `conversion_charge_rate` | Decimal(12, 2)      | nullable           |
| `conversion_rate_basis`  | ConversionRateBasis | nullable           |
| `valid_from`             | Date                | nullable           |
| `valid_to`               | Date                | nullable           |
| `notes`                  | VarChar(1000)       | nullable           |
| `created_at`             | Timestamptz(6)      | default now()      |
| `updated_at`             | Timestamptz(6)      |                    |
| `deleted_at`             | Timestamptz(6)      | nullable           |

- `@@index([tenantId, principalId, deletedAt])`
- `@@index([tenantId, validTo])`

#### `job_work_product_mappings` — Prisma model `JobWorkProductMapping`

| column                 | type           | notes              |
| ---------------------- | -------------- | ------------------ |
| `id`                   | Uuid           | default uuid(), PK |
| `tenant_id`            | Uuid           |                    |
| `agreement_id`         | Uuid           |                    |
| `bom_id`               | Uuid           |                    |
| `principal_brand_name` | VarChar(255)   |                    |
| `pack_design_ref`      | VarChar(64)    | nullable           |
| `created_at`           | Timestamptz(6) | default now()      |
| `updated_at`           | Timestamptz(6) |                    |

- `@@unique([agreementId, bomId])`
- `@@index([tenantId, bomId])`

#### `packaging_requirements` — Prisma model `PackagingRequirement`

| column           | type           | notes              |
| ---------------- | -------------- | ------------------ |
| `id`             | Uuid           | default uuid(), PK |
| `tenant_id`      | Uuid           |                    |
| `product_id`     | Uuid           |                    |
| `pack_variant`   | VarChar(128)   |                    |
| `units_per_pack` | Decimal(14, 3) |                    |
| `is_active`      | Boolean        | default true       |
| `notes`          | VarChar(1000)  | nullable           |
| `created_at`     | Timestamptz(6) | default now()      |
| `updated_at`     | Timestamptz(6) |                    |
| `deleted_at`     | Timestamptz(6) | nullable           |

- `@@index([tenantId, productId, isActive, deletedAt], map: "packaging_requirements_tenant_id_product_id_is_active_idx")`

#### `packaging_requirement_lines` — Prisma model `PackagingRequirementLine`

| column           | type                          | notes              |
| ---------------- | ----------------------------- | ------------------ |
| `id`             | Uuid                          | default uuid(), PK |
| `tenant_id`      | Uuid                          |                    |
| `requirement_id` | Uuid                          |                    |
| `item_id`        | Uuid                          |                    |
| `level`          | PackagingLevel                |                    |
| `quantity_per`   | Decimal(14, 3)                |                    |
| `quantity_basis` | PackagingQuantityBasis        |                    |
| `requirement`    | PackagingComponentRequirement | default MANDATORY  |
| `notes`          | VarChar(255)                  | nullable           |
| `created_at`     | Timestamptz(6)                | default now()      |
| `updated_at`     | Timestamptz(6)                |                    |

- `@@unique([requirementId, itemId])`
- `@@index([tenantId, itemId])`

### Procure-to-Pay

#### `purchase_requisitions` — Prisma model `PurchaseRequisition`

| column                     | type                   | notes              |
| -------------------------- | ---------------------- | ------------------ |
| `id`                       | Uuid                   | default uuid(), PK |
| `tenant_id`                | Uuid                   |                    |
| `number`                   | VarChar(32)            |                    |
| `item_id`                  | Uuid                   |                    |
| `stock_at_request`         | Decimal(18, 4)         |                    |
| `reorder_level_at_request` | Decimal(18, 4)         |                    |
| `required_quantity`        | Decimal(18, 4)         |                    |
| `preferred_vendor_id`      | Uuid                   | nullable           |
| `finished_product_id`      | Uuid                   | nullable           |
| `pack_variant`             | VarChar(128)           | nullable           |
| `packaging_component_id`   | Uuid                   | nullable           |
| `packaging_level`          | PackagingLevel         | nullable           |
| `quantity_per_unit`        | Decimal(18, 4)         | nullable           |
| `is_mandatory`             | Boolean                | default true       |
| `trigger_type`             | RequisitionTriggerType | default MANUAL     |
| `production_plan_id`       | Uuid                   | nullable           |
| `requested_by_id`          | Uuid                   | nullable           |
| `approved_by_id`           | Uuid                   | nullable           |
| `approved_at`              | Timestamptz(6)         | nullable           |
| `request_date`             | Timestamptz(6)         | default now()      |
| `required_by_date`         | Timestamptz(6)         | nullable           |
| `status`                   | RequisitionStatus      | default OPEN       |
| `notes`                    | VarChar(1000)          | nullable           |
| `created_at`               | Timestamptz(6)         | default now()      |
| `updated_at`               | Timestamptz(6)         |                    |
| `deleted_at`               | Timestamptz(6)         | nullable           |

- `@@unique([tenantId, number])`
- `@@index([tenantId, status, deletedAt])`
- `@@index([tenantId, itemId])`
- `@@index([tenantId, triggerType, status])`
- `@@index([tenantId, finishedProductId])`
- `@@index([tenantId, packagingComponentId])`

#### `purchase_orders` — Prisma model `PurchaseOrder`

| column                   | type                | notes              |
| ------------------------ | ------------------- | ------------------ |
| `id`                     | Uuid                | default uuid(), PK |
| `tenant_id`              | Uuid                |                    |
| `number`                 | VarChar(32)         |                    |
| `vendor_id`              | Uuid                |                    |
| `po_date`                | Timestamptz(6)      | default now()      |
| `expected_delivery_date` | Timestamptz(6)      | nullable           |
| `payment_terms_days`     | Int                 | default 30         |
| `status`                 | PurchaseOrderStatus | default OPEN       |
| `notes`                  | VarChar(1000)       | nullable           |
| `taxable_amount`         | Decimal(18, 2)      | default 0          |
| `tax_amount`             | Decimal(18, 2)      | default 0          |
| `total_amount`           | Decimal(18, 2)      | default 0          |
| `created_by_id`          | Uuid                |                    |
| `issued_at`              | Timestamptz(6)      | nullable           |
| `created_at`             | Timestamptz(6)      | default now()      |
| `updated_at`             | Timestamptz(6)      |                    |
| `deleted_at`             | Timestamptz(6)      | nullable           |

- `@@unique([tenantId, number])`
- `@@index([tenantId, status, deletedAt])`
- `@@index([tenantId, vendorId])`

#### `purchase_order_lines` — Prisma model `PurchaseOrderLine`

| column              | type           | notes              |
| ------------------- | -------------- | ------------------ |
| `id`                | Uuid           | default uuid(), PK |
| `tenant_id`         | Uuid           |                    |
| `purchase_order_id` | Uuid           |                    |
| `item_id`           | Uuid           |                    |
| `requisition_id`    | Uuid           | nullable           |
| `quantity`          | Decimal(18, 4) |                    |
| `rate`              | Decimal(18, 4) |                    |
| `tax_rate_percent`  | Decimal(5, 2)  | default 0          |
| `taxable_amount`    | Decimal(18, 2) |                    |
| `tax_amount`        | Decimal(18, 2) |                    |
| `total_amount`      | Decimal(18, 2) |                    |
| `quantity_received` | Decimal(18, 4) | default 0          |
| `created_at`        | Timestamptz(6) | default now()      |
| `updated_at`        | Timestamptz(6) |                    |

- `@@index([tenantId, purchaseOrderId])`
- `@@index([tenantId, itemId])`

#### `goods_receipts` — Prisma model `GoodsReceipt`

| column                   | type           | notes              |
| ------------------------ | -------------- | ------------------ |
| `id`                     | Uuid           | default uuid(), PK |
| `tenant_id`              | Uuid           |                    |
| `number`                 | VarChar(32)    |                    |
| `purchase_order_id`      | Uuid           |                    |
| `vendor_id`              | Uuid           |                    |
| `receipt_date`           | Timestamptz(6) | default now()      |
| `vendor_document_number` | VarChar(64)    | nullable           |
| `received_by_id`         | Uuid           |                    |
| `remarks`                | VarChar(1000)  | nullable           |
| `created_at`             | Timestamptz(6) | default now()      |
| `updated_at`             | Timestamptz(6) |                    |
| `deleted_at`             | Timestamptz(6) | nullable           |

- `@@unique([tenantId, number])`
- `@@index([tenantId, purchaseOrderId])`
- `@@index([tenantId, receiptDate])`

#### `goods_receipt_lines` — Prisma model `GoodsReceiptLine`

| column                   | type           | notes              |
| ------------------------ | -------------- | ------------------ |
| `id`                     | Uuid           | default uuid(), PK |
| `tenant_id`              | Uuid           |                    |
| `goods_receipt_id`       | Uuid           |                    |
| `purchase_order_line_id` | Uuid           |                    |
| `item_id`                | Uuid           |                    |
| `vendor_batch_number`    | VarChar(64)    | nullable           |
| `manufacturing_date`     | Date           | nullable           |
| `expiry_date`            | Date           | nullable           |
| `quantity_received`      | Decimal(18, 4) |                    |
| `quantity_rejected`      | Decimal(18, 4) | default 0          |
| `storage_location`       | VarChar(128)   | nullable           |
| `remarks`                | VarChar(1000)  | nullable           |
| `created_at`             | Timestamptz(6) | default now()      |
| `updated_at`             | Timestamptz(6) |                    |
| `stockLot`               | StockLot       | nullable           |

- `@@index([tenantId, goodsReceiptId])`

#### `stock_lots` — Prisma model `StockLot`

| column                  | type           | notes              |
| ----------------------- | -------------- | ------------------ |
| `id`                    | Uuid           | default uuid(), PK |
| `tenant_id`             | Uuid           |                    |
| `lot_number`            | VarChar(32)    |                    |
| `item_id`               | Uuid           |                    |
| `goods_receipt_line_id` | Uuid           | unique             |
| `vendor_batch_number`   | VarChar(64)    | nullable           |
| `manufacturing_date`    | Date           | nullable           |
| `expiry_date`           | Date           | nullable           |
| `quantity_received`     | Decimal(18, 4) |                    |
| `quantity_available`    | Decimal(18, 4) |                    |
| `status`                | StockLotStatus | default QUARANTINE |
| `storage_location`      | VarChar(128)   | nullable           |
| `created_at`            | Timestamptz(6) | default now()      |
| `updated_at`            | Timestamptz(6) |                    |

- `@@unique([tenantId, lotNumber])`
- `@@index([tenantId, itemId, status, expiryDate])`

#### `qc_results` — Prisma model `QcResult`

| column            | type           | notes              |
| ----------------- | -------------- | ------------------ |
| `id`              | Uuid           | default uuid(), PK |
| `tenant_id`       | Uuid           |                    |
| `stock_lot_id`    | Uuid           |                    |
| `decision`        | QcDecision     |                    |
| `test_reference`  | VarChar(64)    | nullable           |
| `remarks`         | VarChar(1000)  | nullable           |
| `inspected_by_id` | Uuid           |                    |
| `inspected_at`    | Timestamptz(6) | default now()      |
| `created_at`      | Timestamptz(6) | default now()      |

- `@@index([tenantId, stockLotId, createdAt])`

#### `stock_ledger_entries` — Prisma model `StockLedgerEntry`

| column                 | type                 | notes                       |
| ---------------------- | -------------------- | --------------------------- |
| `id`                   | BigInt               | default autoincrement(), PK |
| `tenant_id`            | Uuid                 |                             |
| `item_id`              | Uuid                 |                             |
| `stock_lot_id`         | Uuid                 | nullable                    |
| `entry_type`           | StockLedgerEntryType |                             |
| `quantity_delta`       | Decimal(18, 4)       |                             |
| `affects_usable_stock` | Boolean              | default false               |
| `reference`            | VarChar(64)          | nullable                    |
| `notes`                | VarChar(500)         | nullable                    |
| `created_by_id`        | Uuid                 | nullable                    |
| `created_at`           | Timestamptz(6)       | default now()               |

- `@@index([tenantId, itemId, createdAt])`
- `@@index([tenantId, stockLotId, createdAt])`

#### `purchase_invoices` — Prisma model `PurchaseInvoice`

| column                  | type                  | notes              |
| ----------------------- | --------------------- | ------------------ |
| `id`                    | Uuid                  | default uuid(), PK |
| `tenant_id`             | Uuid                  |                    |
| `number`                | VarChar(32)           |                    |
| `vendor_invoice_number` | VarChar(64)           |                    |
| `vendor_id`             | Uuid                  |                    |
| `purchase_order_id`     | Uuid                  |                    |
| `goods_receipt_id`      | Uuid                  |                    |
| `tolerance_exceeded`    | Boolean               | default false      |
| `match_notes`           | VarChar(2000)         | nullable           |
| `invoice_date`          | Timestamptz(6)        |                    |
| `due_date`              | Timestamptz(6)        |                    |
| `payment_terms_days`    | Int                   | default 30         |
| `taxable_amount`        | Decimal(18, 2)        | default 0          |
| `tax_amount`            | Decimal(18, 2)        | default 0          |
| `total_amount`          | Decimal(18, 2)        | default 0          |
| `status`                | PurchaseInvoiceStatus | default BOOKED     |
| `notes`                 | VarChar(1000)         | nullable           |
| `recorded_by_id`        | Uuid                  |                    |
| `created_at`            | Timestamptz(6)        | default now()      |
| `updated_at`            | Timestamptz(6)        |                    |
| `deleted_at`            | Timestamptz(6)        | nullable           |

- `@@unique([tenantId, number])`
- `@@unique([tenantId, vendorId, vendorInvoiceNumber])`
- `@@index([tenantId, status, deletedAt])`
- `@@index([tenantId, dueDate])`

#### `purchase_invoice_lines` — Prisma model `PurchaseInvoiceLine`

| column                | type           | notes              |
| --------------------- | -------------- | ------------------ |
| `id`                  | Uuid           | default uuid(), PK |
| `tenant_id`           | Uuid           |                    |
| `purchase_invoice_id` | Uuid           |                    |
| `item_id`             | Uuid           |                    |
| `quantity`            | Decimal(18, 4) |                    |
| `rate`                | Decimal(18, 4) |                    |
| `tax_rate_percent`    | Decimal(5, 2)  | default 0          |
| `taxable_amount`      | Decimal(18, 2) |                    |
| `tax_amount`          | Decimal(18, 2) |                    |
| `total_amount`        | Decimal(18, 2) |                    |
| `created_at`          | Timestamptz(6) | default now()      |

- `@@index([tenantId, purchaseInvoiceId])`

#### `vendor_payments` — Prisma model `VendorPayment`

| column                | type           | notes              |
| --------------------- | -------------- | ------------------ |
| `id`                  | Uuid           | default uuid(), PK |
| `tenant_id`           | Uuid           |                    |
| `number`              | VarChar(32)    |                    |
| `purchase_invoice_id` | Uuid           |                    |
| `payment_date`        | Timestamptz(6) | default now()      |
| `amount`              | Decimal(18, 2) |                    |
| `reference`           | VarChar(64)    | nullable           |
| `method`              | VarChar(32)    | nullable           |
| `notes`               | VarChar(500)   | nullable           |
| `recorded_by_id`      | Uuid           |                    |
| `created_at`          | Timestamptz(6) | default now()      |
| `updated_at`          | Timestamptz(6) |                    |

- `@@unique([tenantId, number])`
- `@@index([tenantId, purchaseInvoiceId])`

#### `production_plans` — Prisma model `ProductionPlan`

| column                | type                 | notes              |
| --------------------- | -------------------- | ------------------ |
| `id`                  | Uuid                 | default uuid(), PK |
| `tenant_id`           | Uuid                 |                    |
| `number`              | VarChar(32)          |                    |
| `finished_product_id` | Uuid                 |                    |
| `pack_variant`        | VarChar(128)         | nullable           |
| `bom_id`              | Uuid                 | nullable           |
| `planned_quantity`    | Decimal(18, 4)       |                    |
| `planned_date`        | Date                 | nullable           |
| `status`              | ProductionPlanStatus | default PLANNED    |
| `notes`               | VarChar(1000)        | nullable           |
| `created_by_id`       | Uuid                 | nullable           |
| `created_at`          | Timestamptz(6)       | default now()      |
| `updated_at`          | Timestamptz(6)       |                    |
| `deleted_at`          | Timestamptz(6)       | nullable           |

- `@@unique([tenantId, number])`
- `@@index([tenantId, status, deletedAt])`

### Production and Quality Gate

#### `production_orders` — Prisma model `ProductionOrder`

| column             | type                  | notes              |
| ------------------ | --------------------- | ------------------ |
| `id`               | Uuid                  | default uuid(), PK |
| `tenant_id`        | Uuid                  |                    |
| `order_number`     | VarChar(32)           |                    |
| `product_id`       | Uuid                  |                    |
| `bom_id`           | Uuid                  |                    |
| `planned_quantity` | Decimal(14, 3)        |                    |
| `planned_start_on` | Date                  | nullable           |
| `status`           | ProductionOrderStatus | default PLANNED    |
| `created_by_id`    | Uuid                  | nullable           |
| `closed_at`        | Timestamptz(6)        | nullable           |
| `created_at`       | Timestamptz(6)        | default now()      |
| `updated_at`       | Timestamptz(6)        |                    |
| `deleted_at`       | Timestamptz(6)        | nullable           |

- `@@unique([tenantId, orderNumber])`
- `@@index([tenantId, status, deletedAt])`

#### `material_issues` — Prisma model `MaterialIssue`

| column                | type           | notes              |
| --------------------- | -------------- | ------------------ |
| `id`                  | Uuid           | default uuid(), PK |
| `tenant_id`           | Uuid           |                    |
| `production_order_id` | Uuid           |                    |
| `issued_at`           | Timestamptz(6) | default now()      |
| `issued_by_id`        | Uuid           | nullable           |
| `notes`               | VarChar(500)   | nullable           |
| `created_at`          | Timestamptz(6) | default now()      |

- `@@index([tenantId, productionOrderId])`

#### `material_issue_lines` — Prisma model `MaterialIssueLine`

| column              | type           | notes              |
| ------------------- | -------------- | ------------------ |
| `id`                | Uuid           | default uuid(), PK |
| `tenant_id`         | Uuid           |                    |
| `material_issue_id` | Uuid           |                    |
| `item_id`           | Uuid           |                    |
| `lot_id`            | Uuid           |                    |
| `quantity_issued`   | Decimal(14, 3) |                    |
| `is_fefo_override`  | Boolean        | default false      |
| `override_reason`   | VarChar(500)   | nullable           |

- `@@index([materialIssueId])`
- `@@index([lotId])`

#### `batches` — Prisma model `Batch`

| column                  | type               | notes              |
| ----------------------- | ------------------ | ------------------ |
| `id`                    | Uuid               | default uuid(), PK |
| `tenant_id`             | Uuid               |                    |
| `production_order_id`   | Uuid               |                    |
| `batch_number`          | VarChar(32)        |                    |
| `manufactured_on`       | Date               |                    |
| `expiry_date`           | Date               |                    |
| `planned_quantity`      | Decimal(14, 3)     |                    |
| `actual_quantity`       | Decimal(14, 3)     | nullable           |
| `release_status`        | BatchReleaseStatus | default PENDING    |
| `release_decided_at`    | Timestamptz(6)     | nullable           |
| `release_decided_by_id` | Uuid               | nullable           |
| `release_notes`         | Text               | nullable           |
| `created_at`            | Timestamptz(6)     | default now()      |
| `updated_at`            | Timestamptz(6)     |                    |
| `deleted_at`            | Timestamptz(6)     | nullable           |
| `packingRecord`         | BatchPackingRecord | nullable           |
| `finishedGoodsLot`      | FinishedGoodsLot   | nullable           |

- `@@unique([tenantId, batchNumber])`
- `@@index([tenantId, releaseStatus, deletedAt])`

#### `batch_packing_records` — Prisma model `BatchPackingRecord`

| column              | type           | notes              |
| ------------------- | -------------- | ------------------ |
| `id`                | Uuid           | default uuid(), PK |
| `tenant_id`         | Uuid           |                    |
| `batch_id`          | Uuid           | unique             |
| `packed_quantity`   | Decimal(14, 3) |                    |
| `rejected_quantity` | Decimal(14, 3) | default 0          |
| `pack_variant`      | VarChar(128)   | nullable           |
| `packed_on`         | Date           |                    |
| `recorded_by_id`    | Uuid           | nullable           |
| `notes`             | VarChar(500)   | nullable           |
| `created_at`        | Timestamptz(6) | default now()      |
| `updated_at`        | Timestamptz(6) |                    |

- `@@index([tenantId])`

#### `batch_packaging_consumptions` — Prisma model `BatchPackagingConsumption`

| column              | type           | notes              |
| ------------------- | -------------- | ------------------ |
| `id`                | Uuid           | default uuid(), PK |
| `tenant_id`         | Uuid           |                    |
| `packing_record_id` | Uuid           |                    |
| `item_id`           | Uuid           |                    |
| `quantity_consumed` | Decimal(14, 3) |                    |
| `lot_id`            | Uuid           | nullable           |
| `notes`             | VarChar(255)   | nullable           |
| `created_at`        | Timestamptz(6) | default now()      |
| `updated_at`        | Timestamptz(6) |                    |

- `@@unique([packingRecordId, itemId])`
- `@@index([tenantId, itemId])`

#### `finished_goods_lots` — Prisma model `FinishedGoodsLot`

| column               | type           | notes              |
| -------------------- | -------------- | ------------------ |
| `id`                 | Uuid           | default uuid(), PK |
| `tenant_id`          | Uuid           |                    |
| `batch_id`           | Uuid           | unique             |
| `item_id`            | Uuid           |                    |
| `quantity_available` | Decimal(14, 3) |                    |
| `expiry_date`        | Date           |                    |
| `created_at`         | Timestamptz(6) | default now()      |
| `updated_at`         | Timestamptz(6) |                    |

- `@@index([tenantId, itemId, expiryDate])`

## Appendix B — enumerations

These are PostgreSQL enum types. A value not in this list is rejected by the
database, not merely by the form.

- **UserRole** — `ADMIN`, `PURCHASE_MANAGER`, `STORE_OFFICER`, `PRODUCTION_OFFICER`, `QUALITY_OFFICER`, `SALES_MANAGER`, `ACCOUNTANT`, `MANAGEMENT`

- **TenantStatus** — `TRIAL`, `ACTIVE`, `SUSPENDED`

- **UserStatus** — `INVITED`, `ACTIVE`, `DISABLED`

- **AuditAction** — `CREATE`, `UPDATE`, `DELETE`, `SOFT_DELETE`, `RESTORE`

- **PartyType** — `VENDOR`, `CUSTOMER`, `JOB_WORK_PRINCIPAL`

- **PartyStatus** — `ACTIVE`, `INACTIVE`

- **ProductionOrderStatus** — `PLANNED`, `MATERIAL_ISSUED`, `IN_PROGRESS`, `PACKED`, `UNDER_TEST`, `CLOSED`, `CANCELLED`

- **BatchReleaseStatus** — `PENDING`, `RELEASED`, `BLOCKED`

- **PlatformUserStatus** — `ACTIVE`, `DISABLED`

- **ItemType** — `RAW_MATERIAL`, `PACKING_MATERIAL`, `SEMI_FINISHED`, `FINISHED_GOOD`

- **ScheduleClassification** — `NONE`, `H`, `H1`, `X`, `G`

- **PackagingQuantityBasis** — `PER_PACK`, `PER_BATCH`

- **PackagingComponentRequirement** — `MANDATORY`, `OPTIONAL`

- **BillingModel** — `OWN_PROCUREMENT`, `PURE_CONVERSION`

- **ConversionRateBasis** — `PER_BATCH`, `PER_1000_UNITS`, `PER_PACK`, `PER_KG`

- **LicenceType** — `MANUFACTURING`, `GST_REGISTRATION`, `NARCOTICS`

- **RequisitionStatus** — `OPEN`, `APPROVED`, `CONVERTED_TO_PO`, `CANCELLED`

- **PackagingLevel** — `PRIMARY`, `SECONDARY`, `TERTIARY`

- **RequisitionTriggerType** — `AUTO_REORDER`, `MANUAL`

- **ProductionPlanStatus** — `DRAFT`, `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`

- **PurchaseOrderStatus** — `OPEN`, `PARTIALLY_RECEIVED`, `CLOSED`, `CANCELLED`

- **QcDecision** — `ACCEPTED`, `REJECTED`, `ON_HOLD`

- **StockLotStatus** — `QUARANTINE`, `USABLE`, `REJECTED`, `ON_HOLD`, `CONSUMED`

- **PurchaseInvoiceStatus** — `BOOKED`, `PARTIALLY_PAID`, `PAID`, `CANCELLED`

- **StockLedgerEntryType** — `GRN_QUARANTINE`, `QC_ACCEPTED`, `QC_REJECTED`, `QC_HOLD`, `QC_RELEASED_FROM_HOLD`, `ADJUSTMENT`
