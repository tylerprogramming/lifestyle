"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <div className="wrap login">
      <header>
        <h1>Lifestyle OS</h1>
      </header>
      <div className="tag">consistency over intensity</div>
      <form action={action} className="panel">
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoComplete="current-password"
          autoFocus
          required
        />
        <button type="submit" disabled={pending}>
          {pending ? "Checking..." : "Open dashboard"}
        </button>
        {error && <div className="err">{error}</div>}
      </form>
    </div>
  );
}
