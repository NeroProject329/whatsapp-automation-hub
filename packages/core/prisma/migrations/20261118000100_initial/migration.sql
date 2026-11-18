-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "code" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'MARKETING',
    "source" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "fingerprint" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("fingerprint")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "committedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "desired" TEXT NOT NULL DEFAULT 'OFF',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'OFFLINE',
    "accountPhone" TEXT,
    "lastError" TEXT,
    "lastSeen" TIMESTAMP(3),
    "qr" TEXT,
    "qrExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthEntry" (
    "connectionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AuthEntry_pkey" PRIMARY KEY ("connectionId","category","key")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "audience" TEXT[],
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "windowStart" INTEGER NOT NULL,
    "windowEnd" INTEGER NOT NULL,
    "approval" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispatch" (
    "id" TEXT NOT NULL,
    "uniqueKey" TEXT NOT NULL,
    "campaignId" TEXT,
    "connectionId" TEXT NOT NULL,
    "contactId" TEXT,
    "kind" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "body" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "providerId" TEXT,
    "code" TEXT,
    "submittedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelEvent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "contactId" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "text" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Runtime" (
    "id" TEXT NOT NULL,
    "beat" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Runtime_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Audit_at_idx" ON "Audit"("at");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_phone_key" ON "Contact"("phone");

-- CreateIndex
CREATE INDEX "Contact_updatedAt_idx" ON "Contact"("updatedAt");

-- CreateIndex
CREATE INDEX "Consent_contactId_purpose_revokedAt_idx" ON "Consent"("contactId", "purpose", "revokedAt");

-- CreateIndex
CREATE INDEX "ImportBatch_expiresAt_idx" ON "ImportBatch"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_accountPhone_key" ON "Connection"("accountPhone");

-- CreateIndex
CREATE UNIQUE INDEX "Template_name_version_key" ON "Template"("name", "version");

-- CreateIndex
CREATE INDEX "Campaign_state_scheduledAt_idx" ON "Campaign"("state", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_uniqueKey_key" ON "Dispatch"("uniqueKey");

-- CreateIndex
CREATE INDEX "Dispatch_state_dueAt_idx" ON "Dispatch"("state", "dueAt");

-- CreateIndex
CREATE INDEX "Dispatch_campaignId_state_idx" ON "Dispatch"("campaignId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_campaignId_contactId_key" ON "Dispatch"("campaignId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_connectionId_providerId_key" ON "Dispatch"("connectionId", "providerId");

-- CreateIndex
CREATE INDEX "ChannelEvent_connectionId_providerId_idx" ON "ChannelEvent"("connectionId", "providerId");

-- CreateIndex
CREATE INDEX "ChannelEvent_kind_createdAt_idx" ON "ChannelEvent"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelEvent_connectionId_key_key" ON "ChannelEvent"("connectionId", "key");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthEntry" ADD CONSTRAINT "AuthEntry_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
