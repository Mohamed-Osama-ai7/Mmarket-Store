const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const http = require("node:http");
const orderRoutes = require("../route/order.route");

test("unauthenticated guest checkout is rejected", async () => {
  const app = express(); app.use(express.json()); app.use("/api/v1/order", orderRoutes);
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/order/guest-checkout`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "guest-no-order-test" },
      body: JSON.stringify({ name: "Guest", email: "guest@example.com", items: [] })
    });
    assert.equal(response.status, 401);
    const body = await response.json(); assert.equal(body.error, "Authentication required");
    assert.match(body.message, /sign up or log in/i);

    const directCheckout = await fetch(`http://127.0.0.1:${address.port}/api/v1/order/checkout`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "guest-direct-order-test" },
      body: JSON.stringify({ deliveryDetails: { name: "Guest", phone: "01012345678", address: "Cairo, Egypt, building 10" } })
    });
    assert.equal(directCheckout.status, 401, "the authenticated checkout route must reject a guest before order creation");
  } finally { await new Promise(resolve => server.close(resolve)); }
});
