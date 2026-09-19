-- Removes the goods-receipt fields that are no longer part of the GRN flow.
--
-- WHAT A RECEIPT NOW CAPTURES is the eight things on the delivery note: the
-- generated GRN number, the order it is against, the item that order line
-- names, the vendor's batch number, the manufacturing and expiry dates, the
-- quantity that arrived, and who booked it. Everything else went.
--
-- THE ONE SEMANTIC CHANGE IS quantity_rejected. It recorded material refused at
-- the gate before QC saw it, and two things read it: the quantity that entered
-- quarantine (received minus rejected) and the quantity the vendor was entitled
-- to invoice for. With the column gone, everything received enters quarantine
-- and QC's accept/reject decision on the lot becomes the only rejection in the
-- flow. No data is lost -- every row in this database has quantity_rejected = 0,
-- so the two derived figures are unchanged for every existing receipt.
--
-- stock_lots.storage_location goes with goods_receipt_lines.storage_location
-- because the GRN was its only writer. Leaving it would mean a column that can
-- never be populated again, displayed blank on incoming QC and the stock
-- ledger for every lot created from here on.
--
-- Guarded with IF EXISTS so a database that has already been migrated -- or one
-- restored from a snapshot taken after this ran -- replays it without failing.

ALTER TABLE "goods_receipt_lines" DROP COLUMN IF EXISTS "quantity_rejected";
ALTER TABLE "goods_receipt_lines" DROP COLUMN IF EXISTS "storage_location";
ALTER TABLE "goods_receipt_lines" DROP COLUMN IF EXISTS "remarks";

ALTER TABLE "stock_lots" DROP COLUMN IF EXISTS "storage_location";
