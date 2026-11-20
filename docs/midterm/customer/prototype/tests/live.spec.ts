import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
// These tests mutate only the separately prepared isolated customer_test database.
test.skip(
  !process.env.CUSTOMER_LIVE_TEST,
  "Set CUSTOMER_LIVE_TEST=1 after preparing isolated DB fixtures",
);
let fixture: { checkout_product_id: number; return_order_id: number };
test.beforeAll(() => {
  fixture = JSON.parse(readFileSync(".customer-test-fixture.json", "utf8"));
});
test("real sign-in, availability, split checkout, history and cancellation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?mode=live");
  await page.getByLabel("Search products").fill("Browser Checkout Mouse");
  const product = page.getByTestId(`product-${fixture.checkout_product_id}`);
  await expect(product).toHaveCount(1);
  await product.click();
  await expect(
    page.getByText("5 units available", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Quantity", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Add to bag", exact: true }).click();
  await page.getByRole("button", { name: "View bag", exact: true }).click();
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await page.getByLabel("Email", { exact: true }).fill("customer@local.test");
  await page.getByLabel("Password", { exact: true }).fill("LocalDemo!2026");
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .last()
    .click();
  await page.getByLabel("Recipient name").fill("Demo Customer");
  await page.getByLabel("Address line 1").fill("42 Sample Street");
  await page.getByLabel("City", { exact: true }).fill("Brooklyn");
  await page.getByLabel("Postal code").fill("11201");
  await expect(
    page.getByRole("button", { name: "Place order · Simulated payment" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Place order · Simulated payment" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Every item, reserved." }),
  ).toBeVisible();
  await expect(
    page.getByText("3 reserved · Lot", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("2 reserved · Lot", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "../screenshots/07-live-split-order.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Cancel unshipped units (5)" })
    .click();
  await page.getByLabel("Quantity to cancel").fill("5");
  await page
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect(
    page.getByText("5 ordered · 0 shipped · 0 delivered · 5 canceled"),
  ).toBeVisible();
  await page.getByRole("button", { name: "My orders", exact: true }).click();
  await expect(page.locator(".order-row")).not.toHaveCount(0);
  expect(errors).toEqual([]);
});
test("actual delivered shipment timeline and customer-only return initiation", async ({
  page,
}) => {
  await page.goto("/?mode=live");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("customer@local.test");
  await page.getByLabel("Password", { exact: true }).fill("LocalDemo!2026");
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .last()
    .click();
  await page
    .locator(".order-row")
    .filter({ hasText: `Order #${fixture.return_order_id}` })
    .click();
  await expect(
    page.getByText("5 ordered · 3 shipped · 3 delivered · 0 canceled"),
  ).toBeVisible();
  await expect(page.getByText("dispatched", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Return delivered units (3)" })
    .click();
  await page.getByLabel("Return quantity").fill("1");
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Not working as expected");
  await page.getByRole("button", { name: "Submit return request" }).click();
  await expect(page.getByRole("status")).toContainText("requested");
  await expect(
    page.getByRole("button", { name: "Return delivered units (2)" }),
  ).toBeVisible();
  await page.screenshot({
    path: "../screenshots/08-live-tracking-return.png",
    fullPage: true,
  });
});
