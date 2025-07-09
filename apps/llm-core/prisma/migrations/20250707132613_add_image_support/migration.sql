-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "hasImages" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MessageImage" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "imageType" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantFact" (
    "id" TEXT NOT NULL,
    "fact" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'active',
    "extracted_from_message_id" TEXT,
    "confidence" DOUBLE PRECISION DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageImage_messageId_idx" ON "MessageImage"("messageId");

-- AddForeignKey
ALTER TABLE "MessageImage" ADD CONSTRAINT "MessageImage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
