-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('customer', 'vendor_owner', 'vendor_staff', 'admin');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('pending', 'approved', 'suspended', 'banned');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('draft', 'pending_review', 'active', 'rejected', 'archived');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('active', 'committed', 'released', 'expired');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending_payment', 'payment_failed', 'processing', 'partially_completed', 'completed', 'canceled', 'refunded');

-- CreateEnum
CREATE TYPE "SubOrderStatus" AS ENUM ('awaiting_vendor', 'accepted', 'preparing', 'ready_to_ship', 'shipped', 'delivery_failed', 'delivered', 'return_requested', 'returned', 'completed', 'rejected_by_vendor', 'canceled_by_customer', 'canceled_by_admin', 'refunded');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'requires_action', 'authorized', 'captured', 'partially_refunded', 'refunded', 'failed', 'voided');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('sale_credit', 'commission_debit', 'shipping_credit', 'hold_release_out', 'hold_release_in', 'refund_debit', 'payout_debit', 'adjustment_credit', 'adjustment_debit', 'fx_rounding');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('requested', 'approved', 'processing', 'paid', 'rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT,
    "fullName" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "emailVerifiedAt" TIMESTAMPTZ,
    "phoneVerifiedAt" TIMESTAMPTZ,
    "totpSecretEnc" TEXT,
    "totpEnabledAt" TIMESTAMPTZ,
    "lastLoginAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "grantedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","role")
);

-- CreateTable
CREATE TABLE "admin_permissions" (
    "userId" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "grantedBy" UUID,
    "grantedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_permissions_pkey" PRIMARY KEY ("userId","permission")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "consumedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "minorUnitDigits" INTEGER NOT NULL,
    "minPayoutMinorUnits" BIGINT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "baseCode" CHAR(3) NOT NULL,
    "quoteCode" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "source" TEXT NOT NULL,
    "effectiveAt" TIMESTAMPTZ NOT NULL,
    "fetchedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "logoKey" TEXT,
    "coverKey" TEXT,
    "descriptionAr" TEXT,
    "descriptionEn" TEXT,
    "status" "VendorStatus" NOT NULL DEFAULT 'pending',
    "rejectionReason" TEXT,
    "settlementCurrency" CHAR(3) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "shippingPolicyAr" TEXT,
    "returnPolicyAr" TEXT,
    "ratingAvg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMPTZ,
    "approvedBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_documents" (
    "id" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rejectReason" TEXT,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bank_accounts" (
    "id" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "holderName" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "swift" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "slug" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "iconKey" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attributes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "inputType" TEXT NOT NULL,
    "unit" TEXT,
    "isFilterable" BOOLEAN NOT NULL DEFAULT true,
    "isVariantAxis" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_values" (
    "id" UUID NOT NULL,
    "attributeId" UUID NOT NULL,
    "valueAr" TEXT NOT NULL,
    "valueEn" TEXT,
    "hexColor" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "attribute_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_attributes" (
    "categoryId" UUID NOT NULL,
    "attributeId" UUID NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "category_attributes_pkey" PRIMARY KEY ("categoryId","attributeId")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "logoKey" TEXT,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "brandId" UUID,
    "slug" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "descriptionAr" TEXT,
    "descriptionEn" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'draft',
    "rejectReason" TEXT,
    "hasVariants" BOOLEAN NOT NULL DEFAULT false,
    "ratingAvg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "soldCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "priceMinorUnits" BIGINT NOT NULL,
    "compareAtPriceMinorUnits" BIGINT,
    "barcode" TEXT,
    "weightGrams" INTEGER,
    "lengthMm" INTEGER,
    "widthMm" INTEGER,
    "heightMm" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_option_values" (
    "variantId" UUID NOT NULL,
    "attributeId" UUID NOT NULL,
    "attributeValueId" UUID NOT NULL,

    CONSTRAINT "variant_option_values_pkey" PRIMARY KEY ("variantId","attributeId")
);

-- CreateTable
CREATE TABLE "product_attribute_values" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "attributeId" UUID NOT NULL,
    "attributeValueId" UUID,
    "valueTextAr" TEXT,
    "valueNumber" DECIMAL(16,4),
    "valueBoolean" BOOLEAN,

    CONSTRAINT "product_attribute_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID,
    "fileKey" TEXT NOT NULL,
    "altAr" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "variantId" UUID NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "backorderAllowed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("variantId")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "cartId" UUID,
    "orderId" UUID,
    "qty" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "committedAt" TIMESTAMPTZ,
    "releasedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "actorUserId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "sessionToken" TEXT,
    "currency" CHAR(3) NOT NULL,
    "couponCode" TEXT,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "priceMinorUnitsAtAdd" BIGINT NOT NULL,
    "addedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" TEXT,
    "country" CHAR(2) NOT NULL,
    "region" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "area" TEXT,
    "street" TEXT NOT NULL,
    "building" TEXT,
    "floor" TEXT,
    "landmark" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "recipientName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerUserId" UUID,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "itemsSubtotalMinorUnits" BIGINT NOT NULL,
    "shippingTotalMinorUnits" BIGINT NOT NULL DEFAULT 0,
    "discountTotalMinorUnits" BIGINT NOT NULL DEFAULT 0,
    "taxTotalMinorUnits" BIGINT NOT NULL DEFAULT 0,
    "grandTotalMinorUnits" BIGINT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending_payment',
    "shippingAddressSnapshot" JSONB NOT NULL,
    "billingAddressSnapshot" JSONB,
    "customerNote" TEXT,
    "placedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceledAt" TIMESTAMPTZ,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_orders" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "subOrderNumber" TEXT NOT NULL,
    "settlementCurrency" CHAR(3) NOT NULL,
    "fxRateSnapshot" DECIMAL(20,10) NOT NULL,
    "itemsSubtotalMinorUnits" BIGINT NOT NULL,
    "shippingMinorUnits" BIGINT NOT NULL DEFAULT 0,
    "discountMinorUnits" BIGINT NOT NULL DEFAULT 0,
    "taxMinorUnits" BIGINT NOT NULL DEFAULT 0,
    "totalMinorUnits" BIGINT NOT NULL,
    "commissionRateBpsSnapshot" INTEGER NOT NULL,
    "commissionMinorUnits" BIGINT NOT NULL,
    "vendorNetMinorUnits" BIGINT NOT NULL,
    "status" "SubOrderStatus" NOT NULL DEFAULT 'awaiting_vendor',
    "placedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ,
    "shippedAt" TIMESTAMPTZ,
    "deliveredAt" TIMESTAMPTZ,
    "holdReleaseAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "canceledAt" TIMESTAMPTZ,
    "cancelReason" TEXT,

    CONSTRAINT "sub_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "subOrderId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productNameSnapshotAr" TEXT NOT NULL,
    "variantLabelSnapshot" TEXT,
    "skuSnapshot" TEXT NOT NULL,
    "imageKeySnapshot" TEXT,
    "unitPriceMinorUnits" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL,
    "lineSubtotalMinorUnits" BIGINT NOT NULL,
    "lineDiscountMinorUnits" BIGINT NOT NULL DEFAULT 0,
    "lineTaxMinorUnits" BIGINT NOT NULL DEFAULT 0,
    "lineTotalMinorUnits" BIGINT NOT NULL,
    "commissionBpsSnapshot" INTEGER NOT NULL,
    "commissionMinorUnits" BIGINT NOT NULL,
    "refundedQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_order_status_history" (
    "id" UUID NOT NULL,
    "subOrderId" UUID NOT NULL,
    "fromStatus" "SubOrderStatus",
    "toStatus" "SubOrderStatus" NOT NULL,
    "actorUserId" UUID,
    "actorRole" "Role",
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sub_order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zones" (
    "id" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "nameAr" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zone_regions" (
    "id" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "region" TEXT,
    "city" TEXT,

    CONSTRAINT "shipping_zone_regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_rates" (
    "id" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "priceMinorUnits" BIGINT NOT NULL DEFAULT 0,
    "perKgMinorUnits" BIGINT,
    "freeOverMinorUnits" BIGINT,
    "minDays" INTEGER NOT NULL DEFAULT 1,
    "maxDays" INTEGER NOT NULL DEFAULT 7,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "subOrderId" UUID NOT NULL,
    "carrierCode" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "labelUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "shippedAt" TIMESTAMPTZ,
    "deliveredAt" TIMESTAMPTZ,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "descriptionAr" TEXT,
    "location" TEXT,
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "vendorId" UUID,
    "type" TEXT NOT NULL,
    "valueBps" INTEGER,
    "valueMinorUnits" BIGINT,
    "maxDiscountMinorUnits" BIGINT,
    "minOrderMinorUnits" BIGINT,
    "currency" CHAR(3),
    "usageLimitTotal" INTEGER,
    "usageLimitPerUser" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "fundedBy" TEXT NOT NULL DEFAULT 'platform',
    "startsAt" TIMESTAMPTZ,
    "endsAt" TIMESTAMPTZ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_conditions" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "conditionType" TEXT NOT NULL,
    "refId" UUID,

    CONSTRAINT "coupon_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "userId" UUID,
    "discountMinorUnits" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "region" TEXT,
    "rateBps" INTEGER NOT NULL,
    "isPriceInclusive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMPTZ NOT NULL,
    "effectiveTo" TIMESTAMPTZ,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerIntentId" TEXT,
    "amountMinorUnits" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "authorizedAt" TIMESTAMPTZ,
    "capturedAt" TIMESTAMPTZ,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "paymentId" UUID,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "processedAt" TIMESTAMPTZ,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "subOrderId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amountMinorUnits" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "providerRefundId" TEXT,
    "requestedBy" UUID,
    "approvedBy" UUID,
    "ledgerEntryId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "categoryId" UUID,
    "vendorId" UUID,
    "rateBps" INTEGER NOT NULL,
    "minFeeMinorUnits" BIGINT,
    "maxFeeMinorUnits" BIGINT,
    "effectiveFrom" TIMESTAMPTZ NOT NULL,
    "effectiveTo" TIMESTAMPTZ,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "balancePendingMinorUnits" BIGINT NOT NULL DEFAULT 0,
    "balanceAvailableMinorUnits" BIGINT NOT NULL DEFAULT 0,
    "balanceWithdrawnMinorUnits" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL,
    "direction" TEXT NOT NULL,
    "amountMinorUnits" BIGINT NOT NULL,
    "bucket" TEXT NOT NULL,
    "refType" TEXT,
    "refId" UUID,
    "reversesEntryId" UUID,
    "memo" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_requests" (
    "id" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amountMinorUnits" BIGINT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'requested',
    "bankAccountSnapshot" JSONB NOT NULL,
    "ledgerEntryId" UUID,
    "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMPTZ,
    "paidAt" TIMESTAMPTZ,
    "transferReference" TEXT,
    "rejectReason" TEXT,

    CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rejectReason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_requests" (
    "id" UUID NOT NULL,
    "subOrderId" UUID NOT NULL,
    "itemsJson" JSONB NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "description" TEXT,
    "mediaKeys" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'requested',
    "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedBy" UUID,
    "resolvedAt" TIMESTAMPTZ,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "subOrderId" UUID NOT NULL,
    "openedByUserId" UUID NOT NULL,
    "against" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolvedBy" UUID,
    "closedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_messages" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "senderUserId" UUID NOT NULL,
    "senderRole" "Role" NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" TEXT[],
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "updatedBy" UUID,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "code" VARCHAR(64) NOT NULL,
    "channel" TEXT NOT NULL,
    "locale" CHAR(2) NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variablesJson" JSONB,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("code","channel","locale")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "sentAt" TIMESTAMPTZ,
    "readAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keysJson" JSONB NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_pages" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "bodyAr" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cms_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banners" (
    "id" UUID NOT NULL,
    "placement" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "linkUrl" TEXT,
    "titleAr" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMPTZ,
    "endsAt" TIMESTAMPTZ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "otp_codes_userId_purpose_idx" ON "otp_codes"("userId", "purpose");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "exchange_rates_baseCode_quoteCode_effectiveAt_idx" ON "exchange_rates"("baseCode", "quoteCode", "effectiveAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "vendors_slug_key" ON "vendors"("slug");

-- CreateIndex
CREATE INDEX "vendors_status_idx" ON "vendors"("status");

-- CreateIndex
CREATE INDEX "vendors_settlementCurrency_idx" ON "vendors"("settlementCurrency");

-- CreateIndex
CREATE INDEX "vendor_documents_vendorId_idx" ON "vendor_documents"("vendorId");

-- CreateIndex
CREATE INDEX "vendor_bank_accounts_vendorId_idx" ON "vendor_bank_accounts"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");

-- CreateIndex
CREATE INDEX "categories_path_idx" ON "categories"("path");

-- CreateIndex
CREATE UNIQUE INDEX "attributes_code_key" ON "attributes"("code");

-- CreateIndex
CREATE INDEX "attribute_values_attributeId_idx" ON "attribute_values"("attributeId");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_categoryId_status_publishedAt_idx" ON "products"("categoryId", "status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "products_vendorId_status_idx" ON "products"("vendorId", "status");

-- CreateIndex
CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_productId_sku_key" ON "product_variants"("productId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_attribute_values_productId_attributeId_key" ON "product_attribute_values"("productId", "attributeId");

-- CreateIndex
CREATE INDEX "product_images_productId_sort_idx" ON "product_images"("productId", "sort");

-- CreateIndex
CREATE INDEX "stock_reservations_expiresAt_idx" ON "stock_reservations"("expiresAt");

-- CreateIndex
CREATE INDEX "stock_reservations_cartId_idx" ON "stock_reservations"("cartId");

-- CreateIndex
CREATE INDEX "stock_reservations_orderId_idx" ON "stock_reservations"("orderId");

-- CreateIndex
CREATE INDEX "inventory_movements_variantId_createdAt_idx" ON "inventory_movements"("variantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "carts_sessionToken_key" ON "carts"("sessionToken");

-- CreateIndex
CREATE INDEX "carts_userId_idx" ON "carts"("userId");

-- CreateIndex
CREATE INDEX "carts_expiresAt_idx" ON "carts"("expiresAt");

-- CreateIndex
CREATE INDEX "cart_items_cartId_vendorId_idx" ON "cart_items"("cartId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_variantId_key" ON "cart_items"("cartId", "variantId");

-- CreateIndex
CREATE INDEX "addresses_userId_idx" ON "addresses"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotencyKey_key" ON "orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "orders_customerUserId_placedAt_idx" ON "orders"("customerUserId", "placedAt" DESC);

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sub_orders_subOrderNumber_key" ON "sub_orders"("subOrderNumber");

-- CreateIndex
CREATE INDEX "sub_orders_orderId_idx" ON "sub_orders"("orderId");

-- CreateIndex
CREATE INDEX "sub_orders_vendorId_status_placedAt_idx" ON "sub_orders"("vendorId", "status", "placedAt" DESC);

-- CreateIndex
CREATE INDEX "sub_orders_holdReleaseAt_idx" ON "sub_orders"("holdReleaseAt");

-- CreateIndex
CREATE INDEX "order_items_subOrderId_idx" ON "order_items"("subOrderId");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "sub_order_status_history_subOrderId_createdAt_idx" ON "sub_order_status_history"("subOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "shipping_zones_vendorId_idx" ON "shipping_zones"("vendorId");

-- CreateIndex
CREATE INDEX "shipping_zone_regions_zoneId_idx" ON "shipping_zone_regions"("zoneId");

-- CreateIndex
CREATE INDEX "shipping_zone_regions_country_region_city_idx" ON "shipping_zone_regions"("country", "region", "city");

-- CreateIndex
CREATE INDEX "shipping_rates_zoneId_idx" ON "shipping_rates"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_subOrderId_key" ON "shipments"("subOrderId");

-- CreateIndex
CREATE INDEX "shipment_events_shipmentId_occurredAt_idx" ON "shipment_events"("shipmentId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_isActive_startsAt_endsAt_idx" ON "coupons"("isActive", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "coupon_conditions_couponId_idx" ON "coupon_conditions"("couponId");

-- CreateIndex
CREATE INDEX "coupon_redemptions_couponId_userId_idx" ON "coupon_redemptions"("couponId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_couponId_orderId_key" ON "coupon_redemptions"("couponId", "orderId");

-- CreateIndex
CREATE INDEX "tax_rates_country_region_effectiveFrom_idx" ON "tax_rates"("country", "region", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "payments_orderId_key" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

-- CreateIndex
CREATE INDEX "payment_events_paymentId_idx" ON "payment_events"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_providerEventId_key" ON "payment_events"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "refunds_subOrderId_idx" ON "refunds"("subOrderId");

-- CreateIndex
CREATE INDEX "commission_rules_scope_effectiveFrom_idx" ON "commission_rules"("scope", "effectiveFrom");

-- CreateIndex
CREATE INDEX "commission_rules_vendorId_idx" ON "commission_rules"("vendorId");

-- CreateIndex
CREATE INDEX "commission_rules_categoryId_idx" ON "commission_rules"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_vendorId_currency_key" ON "wallets"("vendorId", "currency");

-- CreateIndex
CREATE INDEX "ledger_entries_vendorId_currency_createdAt_idx" ON "ledger_entries"("vendorId", "currency", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ledger_entries_walletId_bucket_idx" ON "ledger_entries"("walletId", "bucket");

-- CreateIndex
CREATE INDEX "ledger_entries_refType_refId_idx" ON "ledger_entries"("refType", "refId");

-- CreateIndex
CREATE INDEX "payout_requests_vendorId_status_idx" ON "payout_requests"("vendorId", "status");

-- CreateIndex
CREATE INDEX "payout_requests_status_requestedAt_idx" ON "payout_requests"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_orderItemId_key" ON "reviews"("orderItemId");

-- CreateIndex
CREATE INDEX "reviews_productId_status_createdAt_idx" ON "reviews"("productId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "return_requests_subOrderId_idx" ON "return_requests"("subOrderId");

-- CreateIndex
CREATE INDEX "return_requests_status_idx" ON "return_requests"("status");

-- CreateIndex
CREATE INDEX "disputes_subOrderId_idx" ON "disputes"("subOrderId");

-- CreateIndex
CREATE INDEX "disputes_status_idx" ON "disputes"("status");

-- CreateIndex
CREATE INDEX "dispute_messages_disputeId_createdAt_idx" ON "dispute_messages"("disputeId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cms_pages_slug_key" ON "cms_pages"("slug");

-- CreateIndex
CREATE INDEX "banners_placement_isActive_idx" ON "banners"("placement", "isActive");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_permissions" ADD CONSTRAINT "admin_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_baseCode_fkey" FOREIGN KEY ("baseCode") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_quoteCode_fkey" FOREIGN KEY ("quoteCode") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_documents" ADD CONSTRAINT "vendor_documents_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_accounts" ADD CONSTRAINT "vendor_bank_accounts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "attributes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_attributeValueId_fkey" FOREIGN KEY ("attributeValueId") REFERENCES "attribute_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "attributes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_attributeValueId_fkey" FOREIGN KEY ("attributeValueId") REFERENCES "attribute_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_order_status_history" ADD CONSTRAINT "sub_order_status_history_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zones" ADD CONSTRAINT "shipping_zones_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zone_regions" ADD CONSTRAINT "shipping_zone_regions_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_conditions" ADD CONSTRAINT "coupon_conditions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_suborder_fk" FOREIGN KEY ("refId") REFERENCES "sub_orders"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

