-- 联合登录令牌落库：预支付要求以付款人身份调用平台接口，令牌由服务端保存
ALTER TABLE "users" ADD COLUMN "chandler_token" TEXT NOT NULL DEFAULT '';
