/**
 * Order-to-Cash — shared contract between the API and the web app.
 *
 * Every union here mirrors a Prisma enum in packages/database/prisma/schema.prisma
 * by name and by member. That duplication is deliberate and follows the pattern
 * `roles.ts` already sets: the web app must not import from @pharma-erp/database
 * (it would pull the Prisma client into the browser bundle), so the vocabulary
 * is restated in a package both sides can hold. `assertOrderToCashEnumsInSync`
 * in packages/database/src/index.ts fails the build if the two ever drift.
 *
 * Monetary and quantity values cross the wire as STRINGS, not numbers. They are
 * PostgreSQL `numeric` columns, and `JSON.parse` would turn them into IEEE-754
 * doubles — which cannot hold 0.1 exactly, let alone a rupee total that has to
 * reconcile against a ledger. The UI formats them; it never does arithmetic on
 * them.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

export const SCHEDULE_CATEGORIES = [
  'NONE',
  'OTC',
  'SCHEDULE_G',
  'SCHEDULE_H',
  'SCHEDULE_H1',
  'SCHEDULE_H1X',
  'SCHEDULE_X',
  'OTHER',
] as const;
export type ScheduleCategory = (typeof SCHEDULE_CATEGORIES)[number];

export const SCHEDULE_CATEGORY_LABELS: Record<ScheduleCategory, string> = {
  NONE: 'Not scheduled',
  OTC: 'OTC',
  SCHEDULE_G: 'Schedule G',
  SCHEDULE_H: 'Schedule H',
  SCHEDULE_H1: 'Schedule H1',
  SCHEDULE_H1X: 'Schedule H1X',
  SCHEDULE_X: 'Schedule X',
  OTHER: 'Other',
};

/**
 * Schedules the company treats as needing a second compliance look at
 * allocation time, rather than only at order entry.
 *
 * This is a BUSINESS RULE held in one place, not a legal claim: it says which
 * classifications this application asks someone to re-confirm before stock
 * moves. The statutory obligations behind each schedule live in the tenant's
 * SOPs. Both the API (which enforces it) and the UI (which explains it) read
 * this list, so they cannot disagree about which lines need a signature.
 */
export const SCHEDULES_REQUIRING_ALLOCATION_RECHECK: readonly ScheduleCategory[] = [
  'SCHEDULE_H1',
  'SCHEDULE_H1X',
  'SCHEDULE_X',
];

export function requiresAllocationRecheck(category: ScheduleCategory): boolean {
  return SCHEDULES_REQUIRING_ALLOCATION_RECHECK.includes(category);
}

/**
 * THIS MODULE'S OWN COPY of the shared item/batch/payment vocabulary, carrying
 * an `O2c` prefix so it does not collide in the package barrel.
 *
 * It predates main's schema reconstruction and its members genuinely differ
 * from the definitions that now own the unprefixed names — `BatchReleaseStatus`
 * in ./production is PENDING | RELEASED | BLOCKED, `ItemType` in ./procurement
 * has PACKING_MATERIAL and SEMI_FINISHED where this has PACKAGING and
 * CONSUMABLE, and `PaymentStatus` there also carries OVERDUE. Those are not
 * spelling differences, so they are NOT merged here: silently widening or
 * narrowing a release status is exactly the kind of change that turns a
 * quarantined batch into a saleable one.
 *
 * Nothing in the Order-to-Cash UI reads these today. They are kept because the
 * API services in the stash do, and reconciling them against main's vocabulary
 * is part of landing the Order-to-Cash backend, not of porting its screens.
 */
export const O2C_BATCH_RELEASE_STATUSES = [
  'QUARANTINE',
  'UNDER_TEST',
  'RELEASED',
  'REJECTED',
  'ON_HOLD',
  'RECALLED',
] as const;
export type O2cBatchReleaseStatus = (typeof O2C_BATCH_RELEASE_STATUSES)[number];

export const O2C_BATCH_RELEASE_STATUS_LABELS: Record<O2cBatchReleaseStatus, string> = {
  QUARANTINE: 'Quarantine',
  UNDER_TEST: 'Under test',
  RELEASED: 'Released',
  REJECTED: 'Rejected',
  ON_HOLD: 'On hold',
  RECALLED: 'Recalled',
};

export const PRICE_CONTROL_TYPES = ['NONE', 'DPCO', 'NLEM', 'OTHER'] as const;
export type PriceControlType = (typeof PRICE_CONTROL_TYPES)[number];

export const O2C_ITEM_TYPES = ['RAW_MATERIAL', 'PACKAGING', 'FINISHED_GOOD', 'CONSUMABLE'] as const;
export type O2cItemType = (typeof O2C_ITEM_TYPES)[number];

/** Title case, matching ITEM_TYPE_LABELS — same vocabulary, different list. */
export const O2C_ITEM_TYPE_LABELS: Record<O2cItemType, string> = {
  RAW_MATERIAL: 'Raw Material',
  PACKAGING: 'Packaging',
  FINISHED_GOOD: 'Finished Product',
  CONSUMABLE: 'Consumable',
};

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const CUSTOMER_TYPES = [
  'DISTRIBUTOR',
  'STOCKIST',
  'WHOLESALER',
  'RETAIL_CHAIN',
  'HOSPITAL',
  'GOVERNMENT',
  'EXPORT',
  'OTHER',
] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  DISTRIBUTOR: 'Distributor',
  STOCKIST: 'Stockist',
  WHOLESALER: 'Wholesaler',
  RETAIL_CHAIN: 'Retail chain',
  HOSPITAL: 'Hospital / institution',
  GOVERNMENT: 'Government',
  EXPORT: 'Export',
  OTHER: 'Other',
};

export const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const LICENCE_CATEGORIES = ['RETAIL', 'WHOLESALE', 'MANUFACTURING', 'OTHER'] as const;
export type LicenceCategory = (typeof LICENCE_CATEGORIES)[number];

export const LICENCE_CATEGORY_LABELS: Record<LicenceCategory, string> = {
  RETAIL: 'Retail sale',
  WHOLESALE: 'Wholesale',
  MANUFACTURING: 'Manufacturing',
  OTHER: 'Other',
};

/**
 * The licence's REGULATORY STANDING, not its freshness.
 *
 * Distinct from `LicenceStatus` in ./licences, which is derived from the expiry
 * date (VALID | EXPIRING | EXPIRED) and answers "is this licence still in
 * date?". This one answers "has the authority suspended or cancelled it?" — a
 * licence can be well inside its validity window and still be SUSPENDED. Both
 * are real and neither substitutes for the other, so they keep separate names.
 */
export const O2C_LICENCE_STATUSES = ['ACTIVE', 'SUSPENDED', 'CANCELLED'] as const;
export type O2cLicenceStatus = (typeof O2C_LICENCE_STATUSES)[number];

/**
 * How close to expiry a licence has to be before the UI warns about it.
 *
 * A warning, never a refusal: a licence valid for another fortnight is valid,
 * and blocking on it would invent a rule the regulator did not make. The gate
 * refuses only an expired or non-ACTIVE licence.
 */
export const LICENCE_EXPIRY_WARNING_DAYS = 30;

export interface CustomerLicenceView {
  id: string;
  licenceNumber: string;
  category: LicenceCategory;
  formNumber: string | null;
  issuingAuthority: string | null;
  /** ISO date, no time — a licence expires on a day, not at an instant. */
  issueDate: string;
  expiryDate: string;
  status: O2cLicenceStatus;
  coversScheduleX: boolean;
  isPrimary: boolean;
  /** Computed by the API against its own clock, so every client agrees. */
  isExpired: boolean;
  daysToExpiry: number;
  isValid: boolean;
}

export interface CustomerListItem {
  id: string;
  code: string;
  name: string;
  customerType: CustomerType;
  status: CustomerStatus;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  stateCode: string | null;
  billingCity: string | null;
  billingState: string | null;
  creditLimit: string;
  creditTermsDays: number;
  outstandingAmount: string;
  /** creditLimit - outstandingAmount, floored at zero by the API. */
  availableCredit: string;
  /** The licence the order gate would test today, or null if there is none. */
  primaryLicence: CustomerLicenceView | null;
  licenceCount: number;
  /** False when there is no valid licence at all — the gate would refuse. */
  hasValidLicence: boolean;
  createdAt: string;
}

export interface CustomerDetail extends CustomerListItem {
  billingLine1: string | null;
  billingLine2: string | null;
  billingPin: string | null;
  shippingLine1: string | null;
  shippingLine2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingPin: string | null;
  notes: string | null;
  licences: readonly CustomerLicenceView[];
}

export interface CreateCustomerRequest {
  code: string;
  name: string;
  customerType: CustomerType;
  contactPerson?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  stateCode?: string;
  billingLine1?: string;
  billingLine2?: string;
  billingCity?: string;
  billingState?: string;
  billingPin?: string;
  shippingLine1?: string;
  shippingLine2?: string;
  shippingCity?: string;
  shippingState?: string;
  shippingPin?: string;
  creditLimit?: string;
  creditTermsDays?: number;
  notes?: string;
}

export type UpdateCustomerRequest = Partial<Omit<CreateCustomerRequest, 'code'>> & {
  status?: CustomerStatus;
};

export interface CreateCustomerLicenceRequest {
  licenceNumber: string;
  category: LicenceCategory;
  formNumber?: string;
  issuingAuthority?: string;
  issueDate: string;
  expiryDate: string;
  coversScheduleX?: boolean;
  isPrimary?: boolean;
  notes?: string;
}

export type UpdateCustomerLicenceRequest = Partial<CreateCustomerLicenceRequest> & {
  status?: O2cLicenceStatus;
};

// ---------------------------------------------------------------------------
// Sales orders
// ---------------------------------------------------------------------------

export const SALES_ORDER_STATUSES = [
  'DRAFT',
  'PENDING_CHECK',
  'APPROVED',
  'BLOCKED',
  'PARTIALLY_ALLOCATED',
  'ALLOCATED',
  'DISPATCHED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export const SALES_ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  DRAFT: 'Draft',
  PENDING_CHECK: 'Pending check',
  APPROVED: 'Approved',
  BLOCKED: 'Blocked',
  PARTIALLY_ALLOCATED: 'Partly allocated',
  ALLOCATED: 'Allocated',
  DISPATCHED: 'Dispatched',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const SALES_ORDER_ITEM_STATUSES = [
  'PENDING',
  'PARTIALLY_ALLOCATED',
  'ALLOCATED',
  'DISPATCHED',
  'CANCELLED',
] as const;
export type SalesOrderItemStatus = (typeof SALES_ORDER_ITEM_STATUSES)[number];

export const CHECK_RESULTS = ['NOT_RUN', 'PASS', 'FAIL'] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

export const CHECK_RESULT_LABELS: Record<CheckResult, string> = {
  NOT_RUN: 'Not run',
  PASS: 'Pass',
  FAIL: 'Fail',
};

export interface SalesOrderItemView {
  id: string;
  lineNumber: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  packSize: string | null;
  scheduleCategory: ScheduleCategory;
  hsnCode: string | null;
  quantityOrdered: string;
  quantityAllocated: string;
  quantityDispatched: string;
  unitPrice: string;
  discountPercent: string;
  discountAmount: string;
  gstRatePercent: string;
  taxAmount: string;
  lineTotal: string;
  status: SalesOrderItemStatus;
}

/**
 * The gate's verdict, as both the API and the UI understand it.
 *
 * Returned by the check endpoint AND embedded in every order view, so the list
 * can show the two badges without a second round trip. The figures travel with
 * the verdict because a bare "FAIL" is not actionable — the person needs to see
 * the limit, the balance, and the shortfall.
 */
export interface OrderCheckResult {
  licenceCheck: CheckResult;
  creditCheck: CheckResult;
  /** Overall: true only when BOTH gates pass. */
  passed: boolean;
  failureReason: string | null;
  checkedAt: string | null;

  /** Credit position at the moment of the check. */
  outstandingAmount: string | null;
  creditLimit: string | null;
  availableCredit: string | null;
  orderAmount: string | null;
  /** outstanding + order - limit, when positive. Null when the gate passed. */
  creditShortfall: string | null;

  /** Which licence was tested. */
  licenceNumber: string | null;
  licenceExpiryDate: string | null;
  licenceDaysToExpiry: number | null;
}

export interface SalesOrderListItem {
  id: string;
  orderNumber: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  orderDate: string;
  requestedDeliveryDate: string | null;

  /** The customer's own reference for this order. */
  customerPoNumber: string | null;
  /** Terms agreed for THIS order, not the party's standing terms. */
  shippingTerms: string | null;
  insurance: string | null;
  transportName: string | null;

  status: SalesOrderStatus;
  totalQuantity: string;
  /** Goods value: the lines, net of their discounts, before tax. */
  subtotal: string;

  /** The products on the order, for the list: the first, then "+2" for the rest. */
  productSummary: string;

  /**
   * The tax split, derived the way the INVOICE derives it — seller state
   * against the customer's — so the list and the eventual invoice agree.
   *
   * Indicative until the invoice is raised: the place of supply is settled
   * then, and the order records no invoice yet. The total tax is not
   * indicative; only which heads it falls under.
   */
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;

  /** Rounding to the rupee. Derived for display; not stored on the order. */
  roundOff: string;
  /**
   * Charged on the order and taxed with the goods.
   *
   * `subtotal + processingCharges` is the taxable amount, which is what
   * `taxAmount` was computed on.
   */
  processingCharges: string;
  taxAmount: string;
  grandTotal: string;
  licenceCheck: CheckResult;
  creditCheck: CheckResult;
  checkFailureReason: string | null;
  itemCount: number;
  /** The order's own remarks. On the list item so a row can be edited without
   *  a second fetch for one field. */
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface SalesOrderDetail extends SalesOrderListItem {
  notes: string | null;
  items: readonly SalesOrderItemView[];
  check: OrderCheckResult;
  /** True when every line is fully allocated. */
  isFullyAllocated: boolean;
  hasInvoice: boolean;
  updatedAt: string;
}

export interface CreateSalesOrderItemRequest {
  itemId: string;
  quantityOrdered: string;
  /** Defaults to the item's MRP when omitted. */
  unitPrice?: string;
  discountPercent?: string;
}

export interface CreateSalesOrderRequest {
  customerId: string;
  orderDate: string;
  requestedDeliveryDate?: string;

  customerPoNumber?: string;
  shippingTerms?: string;
  insurance?: string;
  transportName?: string;
  /** Order-level charge, taxed with the goods. Defaults to zero. */
  processingCharges?: string;

  notes?: string;
  items: readonly CreateSalesOrderItemRequest[];
}

/**
 * What a customer owes, read from the receivable ledger.
 *
 * READ-ONLY AND DERIVED. The ledger is written by the invoice, receipt and
 * credit-note flows and is append-only in the database; this is a view of it
 * for the order screen, so the figures cannot drift from the entries.
 */
export interface CustomerBalance {
  customerId: string;
  /** Debits less credits. Positive means the customer owes. */
  ledgerBalance: string;
  /** Of that, the part whose invoice due date has passed. */
  overdueAmount: string;
  /** False when the ledger cannot be read; the screen then says so. */
  available: boolean;
}

/**
 * An item's packaging specification, for the Sales Order's product panel.
 *
 * Every field is optional because the master fills them in over time: what
 * exists is shown, what does not is left blank rather than invented.
 */
/**
 * Whether the product's formulation can still be made to.
 *
 * ACTIVE     one approved, active version — the ordinary case, nothing to say
 * SUSPENDED  versions exist but none is active, so production has no
 *            formulation to work from until one is reactivated
 * NONE       no formulation at all, which is normal for a traded product
 *
 * SUSPENDED is the one worth a warning. NONE looks the same from the order
 * screen but means something different, and warning about it would put a red
 * flag on every bought-in line.
 */
export type ProductBomStatus = 'ACTIVE' | 'SUSPENDED' | 'NONE';

export interface ItemPackagingSpec {
  itemId: string;
  itemCode: string;
  itemName: string;
  brandName: string | null;
  genericName: string | null;
  hsnCode: string | null;
  uom: string;
  mrp: string | null;
  scheduleClassification: string;
  storageConditions: string | null;
  /** From PackagingRequirement: the pack variant and its components. */
  packVariant: string | null;
  unitsPerPack: string | null;
  primaryComponents: readonly PackagingComponentView[];
  secondaryComponents: readonly PackagingComponentView[];
  tertiaryComponents: readonly PackagingComponentView[];

  /** The state of this product's formulation. Read-only; see ProductBomStatus. */
  bomStatus: ProductBomStatus;
  /** The active version, or the highest one on file when none is active. */
  bomVersion: number | null;
}

export interface PackagingComponentView {
  itemCode: string;
  itemName: string;
  quantityPer: string;
  uom: string;
}

// ---------------------------------------------------------------------------
// Sales order fulfilment trace — US-SAL-08
// ---------------------------------------------------------------------------

/**
 * Where an order has got to, DERIVED from the records that exist for it.
 *
 * No column anywhere holds this. It is read off the linked procurement,
 * production, allocation and despatch rows every time it is asked for, so it
 * cannot drift from them the way a stored stage would.
 *
 * NOT_STARTED and CANCELLED are not in the story's four stages, and are here
 * because the data has those cases: an order with nothing raised against it
 * yet is not "awaiting material" — nobody has asked for any — and a cancelled
 * order is not somewhere in the pipeline at all.
 */
export const FULFILMENT_STAGES = [
  'NOT_STARTED',
  'AWAITING_MATERIAL',
  'IN_PRODUCTION',
  'READY_TO_DISPATCH',
  'DISPATCHED',
  'CANCELLED',
] as const;

export type FulfilmentStage = (typeof FULFILMENT_STAGES)[number];

export const FULFILMENT_STAGE_LABELS: Record<FulfilmentStage, string> = {
  NOT_STARTED: 'Not started',
  AWAITING_MATERIAL: 'Awaiting material',
  IN_PRODUCTION: 'In production',
  READY_TO_DISPATCH: 'Ready to dispatch',
  DISPATCHED: 'Dispatched',
  CANCELLED: 'Cancelled',
};

/** A purchase requisition raised to serve this order. */
export interface TraceRequisition {
  id: string;
  number: string;
  itemCode: string;
  itemName: string;
  quantity: string;
  status: string;
  raisedOn: string;
}

/** A purchase order carrying at least one line for this order's requisitions. */
export interface TracePurchaseOrder {
  id: string;
  number: string;
  vendorName: string;
  status: string;
  orderedOn: string;
  /** The requisition numbers this order covers, of those raised for this sale. */
  requisitionNumbers: readonly string[];
}

/** A goods receipt against one of those purchase orders. */
export interface TraceGoodsReceipt {
  id: string;
  number: string;
  purchaseOrderNumber: string;
  vendorName: string;
  receivedOn: string;
  lineCount: number;
}

/**
 * A work order raised for this sale, with what it produced.
 *
 * BMR and BPR are not separate tables: the BMR is the `Batch` record itself and
 * the BPR is its packing record, which is how the Production screens name them.
 * They are reported as the fields of the batch rather than as invented rows.
 */
export interface TraceWorkOrder {
  id: string;
  number: string;
  productCode: string;
  productName: string;
  plannedQuantity: string;
  status: string;
  batches: readonly TraceBatch[];
}

export interface TraceBatch {
  id: string;
  batchNumber: string;
  /** The BMR: manufacture recorded against the batch. Null until it is. */
  manufacturedOn: string | null;
  actualQuantity: string | null;
  expiryDate: string;
  /** The BPR: the packing record, null until packing is recorded. */
  packedQuantity: string | null;
  packedOn: string | null;
  packVariant: string | null;
  releaseStatus: string;
  releasedOn: string | null;
}

export interface TraceDispatch {
  id: string;
  dispatchNumber: string;
  dispatchDate: string;
  status: DispatchStatus;
  totalQuantity: string;
  invoiceNumber: string | null;
}

/**
 * The whole chain behind one order, read-only — US-SAL-08.
 *
 * "Record created: none." Every field here is read from rows that already
 * exist, through relationships that already exist; nothing is written, and
 * there is no trace table.
 */
export interface SalesOrderTrace {
  salesOrderId: string;
  orderNumber: string;
  customerName: string;
  orderStatus: SalesOrderStatus;

  stage: FulfilmentStage;
  /** Why the stage is what it is, in one sentence, from the same records. */
  stageReason: string;

  requisitions: readonly TraceRequisition[];
  purchaseOrders: readonly TracePurchaseOrder[];
  goodsReceipts: readonly TraceGoodsReceipt[];

  workOrders: readonly TraceWorkOrder[];

  /** Reservations standing against the order, which is what despatch draws on. */
  allocationCount: number;
  allocatedQuantity: string;
  dispatches: readonly TraceDispatch[];
}

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

export const ALLOCATION_STATUSES = [
  'ALLOCATED',
  'PARTIALLY_DISPATCHED',
  'DISPATCHED',
  'RELEASED_BACK',
  'CANCELLED',
] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

export const ALLOCATION_STATUS_LABELS: Record<AllocationStatus, string> = {
  ALLOCATED: 'Allocated',
  PARTIALLY_DISPATCHED: 'Partly dispatched',
  DISPATCHED: 'Dispatched',
  RELEASED_BACK: 'Released back',
  CANCELLED: 'Cancelled',
};

export interface AllocationRow {
  id: string;
  salesOrderId: string;
  orderNumber: string;
  customerName: string;
  salesOrderItemId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  batchId: string;
  batchNumber: string;
  /** The expiry as it stood when allocated — see the schema's note on snapshots. */
  expiryDate: string;
  scheduleCategory: ScheduleCategory;
  quantityOrdered: string;
  quantityAllocated: string;
  quantityDispatched: string;
  status: AllocationStatus;
  complianceRecheckRequired: boolean;
  complianceCheckedAt: string | null;
  complianceCheckedByName: string | null;
  allocatedByName: string | null;
  createdAt: string;
}

/**
 * What FEFO would do, before it does it.
 *
 * The allocation screen shows this as a preview so the plan is reviewable
 * BEFORE stock is reserved. Recomputed server-side on commit — a preview that
 * the client could edit and post back would make the FEFO rule advisory.
 */
export interface AllocationPlanLine {
  salesOrderItemId: string;
  lineNumber: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  scheduleCategory: ScheduleCategory;
  quantityOrdered: string;
  quantityOutstanding: string;
  /** Sum of the picks below. Less than quantityOutstanding when stock is short. */
  quantityPlanned: string;
  isShort: boolean;
  shortfall: string;
  picks: readonly AllocationPlanPick[];
  /** Why nothing, or not enough, could be picked. */
  note: string | null;
}

export interface AllocationPlanPick {
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  quantityAvailable: string;
  quantityToAllocate: string;
  requiresComplianceRecheck: boolean;
}

export interface AllocationPlan {
  salesOrderId: string;
  orderNumber: string;
  customerName: string;
  orderStatus: SalesOrderStatus;
  /** False when the order has not passed both gates; then `lines` is empty. */
  canAllocate: boolean;
  blockedReason: string | null;
  lines: readonly AllocationPlanLine[];
  anyShort: boolean;
}

export interface RecordComplianceCheckRequest {
  notes?: string;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const O2C_PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'] as const;
export type O2cPaymentStatus = (typeof O2C_PAYMENT_STATUSES)[number];

export const O2C_PAYMENT_STATUS_LABELS: Record<O2cPaymentStatus, string> = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Part paid',
  PAID: 'Paid',
};

export interface SalesInvoiceItemView {
  id: string;
  lineNumber: number;
  itemId: string;
  description: string;
  hsnCode: string | null;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  mrp: string | null;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxableValue: string;
  gstRatePercent: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  taxAmount: string;
  lineTotal: string;
  ceilingPriceAtInvoice: string | null;
  quantityReturned: string;
}

export interface SalesInvoiceListItem {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  salesOrderId: string | null;
  orderNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
  paymentStatus: O2cPaymentStatus;
  subtotal: string;

  /**
   * The tax as it was charged, head by head.
   *
   * A lumped "GST" figure hides which heads were applied: an inter-state sale
   * billed as CGST+SGST comes to exactly the same money and is wrong only in
   * the heads. These are the amounts stored on the invoice when it was issued,
   * not a re-split of `taxAmount`.
   *
   * One side is zero: CGST and SGST carry the tax on an intra-state sale, IGST
   * on an inter-state one, per `isInterState`.
   */
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;

  /** CGST + SGST + IGST, as billed. */
  taxAmount: string;
  grandTotal: string;
  amountPaid: string;
  amountCredited: string;
  /** grandTotal - amountPaid - amountCredited, floored at zero. */
  amountOutstanding: string;
  isInterState: boolean;
  createdByName: string | null;
  createdAt: string;
}

export interface SalesInvoiceDetail extends SalesInvoiceListItem {
  billingName: string;
  billingAddress: string | null;
  shippingName: string | null;
  shippingAddress: string | null;
  customerGstin: string | null;
  sellerGstin: string | null;
  placeOfSupplyStateCode: string | null;
  sellerStateCode: string | null;
  discountAmount: string;
  notes: string | null;
  items: readonly SalesInvoiceItemView[];
}

/**
 * Invoices are raised FROM an order's allocations, not composed line by line.
 *
 * There is no "pick the lines" field, on purpose: the batches on the invoice
 * must be the batches FEFO reserved, and letting a client nominate them would
 * be a way around both the expiry order and the release-status rule.
 */
export interface CreateSalesInvoiceRequest {
  salesOrderId: string;
  invoiceDate?: string;
  notes?: string;
}

/**
 * A refused DPCO/NLEM price check, as the UI renders it.
 *
 * Returned in the 409 body when issuing an invoice would bill above a ceiling,
 * so the screen can name the line and the two figures instead of showing a
 * sentence the user has to decode.
 */
export interface PriceCeilingBreach {
  itemCode: string;
  itemName: string;
  controlType: PriceControlType;
  unitPrice: string;
  ceilingPrice: string;
  sourceReference: string | null;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export const DISPATCH_STATUSES = ['DRAFT', 'DISPATCHED', 'DELIVERED', 'CANCELLED'] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = {
  DRAFT: 'Draft',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export interface DispatchItemView {
  id: string;
  batchAllocationId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  quantityDispatched: string;
}

export interface DispatchListItem {
  id: string;
  dispatchNumber: string;
  salesOrderId: string;
  orderNumber: string;
  salesInvoiceId: string | null;
  invoiceNumber: string | null;
  customerId: string;
  customerName: string;
  dispatchDate: string;
  status: DispatchStatus;
  transporterName: string | null;
  vehicleNumber: string | null;
  lrNumber: string | null;
  ewayBillNumber: string | null;
  totalQuantity: string;
  itemCount: number;
  createdByName: string | null;
  createdAt: string;
}

export interface DispatchDetail extends DispatchListItem {
  notes: string | null;
  items: readonly DispatchItemView[];
}

/**
 * Creating a dispatch takes the invoice, not a list of batches.
 *
 * Same reasoning as CreateSalesInvoiceRequest: the quantities come from the
 * allocations behind that invoice. `lines` exists only to dispatch LESS than
 * was allocated (a part shipment); it can never name a batch that was not
 * allocated, and the service refuses a quantity above the reservation.
 */
export interface CreateDispatchRequest {
  salesInvoiceId: string;
  dispatchDate?: string;
  transporterName?: string;
  vehicleNumber?: string;
  lrNumber?: string;
  ewayBillNumber?: string;
  notes?: string;
  /** Omit to dispatch everything allocated on the invoice. */
  lines?: readonly { batchAllocationId: string; quantityDispatched: string }[];
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export const PAYMENT_METHODS = ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  BANK_TRANSFER: 'Bank transfer',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  CASH: 'Cash',
  OTHER: 'Other',
};

export const RECEIPT_STATUSES = ['RECORDED', 'CLEARED', 'BOUNCED', 'CANCELLED'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  RECORDED: 'Recorded',
  CLEARED: 'Cleared',
  BOUNCED: 'Bounced',
  CANCELLED: 'Cancelled',
};

export interface ReceiptListItem {
  id: string;
  receiptNumber: string;
  customerId: string;
  customerName: string;
  salesInvoiceId: string;
  invoiceNumber: string;
  receiptDate: string;
  amount: string;
  paymentMethod: PaymentMethod;
  referenceNumber: string | null;
  status: ReceiptStatus;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface CreateReceiptRequest {
  salesInvoiceId: string;
  receiptDate: string;
  amount: string;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

export const SALES_RETURN_STATUSES = [
  'DRAFT',
  'RECEIVED',
  'QUARANTINED',
  'CREDITED',
  'CANCELLED',
] as const;
export type SalesReturnStatus = (typeof SALES_RETURN_STATUSES)[number];

export const SALES_RETURN_STATUS_LABELS: Record<SalesReturnStatus, string> = {
  DRAFT: 'Draft',
  RECEIVED: 'Received',
  QUARANTINED: 'Quarantined',
  CREDITED: 'Credited',
  CANCELLED: 'Cancelled',
};

export const RETURN_REASONS = [
  'EXPIRED',
  'NEAR_EXPIRY',
  'DAMAGED',
  'BREAKAGE',
  'WRONG_ITEM',
  'QUALITY_COMPLAINT',
  'RECALL',
  'ORDER_ERROR',
  'OTHER',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
  EXPIRED: 'Expired',
  NEAR_EXPIRY: 'Near expiry',
  DAMAGED: 'Damaged',
  BREAKAGE: 'Breakage',
  WRONG_ITEM: 'Wrong item supplied',
  QUALITY_COMPLAINT: 'Quality complaint',
  RECALL: 'Recall',
  ORDER_ERROR: 'Ordering error',
  OTHER: 'Other',
};

export const RETURNED_STOCK_DISPOSITIONS = ['QUARANTINE', 'DESTROY', 'RESTOCK'] as const;
export type ReturnedStockDisposition = (typeof RETURNED_STOCK_DISPOSITIONS)[number];

export const RETURNED_STOCK_DISPOSITION_LABELS: Record<ReturnedStockDisposition, string> = {
  QUARANTINE: 'Hold in quarantine',
  DESTROY: 'Destroy',
  RESTOCK: 'Return to saleable stock',
};

/**
 * What became of the goods on a return, in quantities — US-SAL-07.
 *
 * DERIVED FROM THE LINES, not stored. `restockedQuantity` is the part whose
 * disposition was RESTOCK and which `receive()` added back to its ORIGINAL
 * batch; it is FREE / UNRESERVED there, because putting stock back raises the
 * lot's available quantity and writes no BatchAllocation — and free stock in
 * this system is precisely "on the lot and not allocated".
 *
 * The rest was quarantined or destroyed and never re-enters saleable stock.
 */
export interface SalesReturnItemView {
  id: string;
  salesInvoiceItemId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: string;
  unitPrice: string;
  gstRatePercent: string;
  taxableValue: string;
  taxAmount: string;
  amount: string;
  reason: ReturnReason;
  disposition: ReturnedStockDisposition;
  notes: string | null;
}

export interface SalesReturnListItem {
  id: string;
  returnNumber: string;
  customerId: string;
  customerName: string;
  salesInvoiceId: string;
  invoiceNumber: string;
  salesOrderId: string | null;
  orderNumber: string | null;
  returnDate: string;
  reason: ReturnReason;
  status: SalesReturnStatus;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  itemCount: number;

  /**
   * Quantity put back into saleable stock on its original batch, free and
   * unreserved — US-SAL-07. Zero until the return is received, and zero for
   * anything not dispositioned RESTOCK.
   */
  restockedQuantity: string;
  /** Quantity held back: quarantined or destroyed. Never re-enters stock. */
  quarantinedQuantity: string;

  createdByName: string | null;
  createdAt: string;
}

export interface SalesReturnDetail extends SalesReturnListItem {
  reasonNotes: string | null;
  notes: string | null;
  items: readonly SalesReturnItemView[];
}

export interface CreateSalesReturnItemRequest {
  salesInvoiceItemId: string;
  quantity: string;
  reason: ReturnReason;
  /** Defaults to QUARANTINE. See the schema note on why. */
  disposition?: ReturnedStockDisposition;
  notes?: string;
}

export interface CreateSalesReturnRequest {
  salesInvoiceId: string;
  returnDate: string;
  reason: ReturnReason;
  reasonNotes?: string;
  notes?: string;
  items: readonly CreateSalesReturnItemRequest[];
}

// ---------------------------------------------------------------------------
// Masters — the minimum Order-to-Cash needs to be usable
// ---------------------------------------------------------------------------

/**
 * These belong to Procure-to-Pay and Production & Quality, and are exposed here
 * only so the Order-to-Cash flow can be exercised end to end before those flows
 * exist. When they arrive, these move; nothing in Order-to-Cash depends on
 * their staying put.
 */
export interface ItemListItem {
  id: string;
  code: string;
  name: string;
  itemType: O2cItemType;
  packSize: string | null;
  unitOfMeasure: string;
  hsnCode: string | null;
  gstRatePercent: string | null;
  scheduleCategory: ScheduleCategory;
  mrp: string | null;
  priceControlType: PriceControlType;
  status: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';

  /**
   * The state of this product's formulation, carried on the LIST so the Sales
   * Order line can say so the moment a product is chosen, rather than after a
   * second request for the specification. See ProductBomStatus.
   */
  bomStatus: ProductBomStatus;
  /**
   * Saleable stock: released, unexpired, and NOT already reserved for another
   * order. This is the figure order entry is checked against.
   */
  availableQuantity: string;

  /**
   * The two halves of that sum, reported separately because they are what makes
   * the difference explicable. Production's batch-release screen shows on-hand
   * stock, which is larger whenever anything is reserved — without these, the
   * same product legitimately reads "10 available" there and "0 saleable" here
   * and nothing on either screen says why.
   */
  quantityOnHand: string;
  quantityReserved: string;
  createdAt: string;
}

export interface CreateMasterItemRequest {
  code: string;
  name: string;
  itemType: O2cItemType;
  packSize?: string;
  unitOfMeasure?: string;
  hsnCode?: string;
  gstRatePercent?: string;
  scheduleCategory?: ScheduleCategory;
  mrp?: string;
  priceControlType?: PriceControlType;
  shelfLifeMonths?: number;
}

export interface BatchListItem {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  batchNumber: string;
  manufacturedOn: string;
  expiryDate: string;
  releaseStatus: O2cBatchReleaseStatus;
  quantityManufactured: string;
  quantityOnHand: string;
  quantityAllocated: string;
  quantityQuarantined: string;
  /** quantityOnHand - quantityAllocated. What FEFO may draw on. */
  quantityAvailable: string;
  mrp: string | null;
  isExpired: boolean;
  daysToExpiry: number;
  /** RELEASED, not expired, and something available. */
  isSaleable: boolean;
  releasedAt: string | null;
  createdAt: string;
}

export interface CreateBatchRequest {
  itemId: string;
  batchNumber: string;
  manufacturedOn: string;
  expiryDate: string;
  quantityManufactured: string;
  mrp?: string;
  notes?: string;
}
