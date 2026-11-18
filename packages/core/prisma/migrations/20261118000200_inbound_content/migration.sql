CREATE TYPE "InboundContent" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER');

ALTER TABLE "ChannelEvent" ADD COLUMN "contentType" "InboundContent";
