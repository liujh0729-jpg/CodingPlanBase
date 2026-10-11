"use client";

import { Button, Result } from "antd";
import Link from "next/link";

export default function NotFound() {
  return (
    <Result
      status="404"
      title="404"
      subTitle="抱歉，你访问的页面不存在。"
      extra={
        <Link href="/">
          <Button type="primary">返回工作台</Button>
        </Link>
      }
    />
  );
}
