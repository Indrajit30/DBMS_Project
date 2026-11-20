import { test, expect, type Page } from "@playwright/test";
async function splitCheckout(page: Page) {
  await page.goto("/");
  await page.getByText("Presentation controls", { exact: true }).click();
  await page.getByRole("button", { name: "Start 5-mouse split story" }).click();
  await expect(
    page.getByRole("heading", { name: "Arc Wireless Mouse", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Product quantity")).toHaveValue("5");
  await page.getByRole("button", { name: "Add to bag" }).click();
  await page.getByRole("button", { name: "View bag", exact: true }).click();
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await expect(
    page.getByRole("button", { name: "Place sample order", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Make it yours." }),
  ).toBeVisible();
}
test("browse, search, filter and responsive catalog; capture catalog", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good tools. Less friction." }),
  ).toBeVisible();
  await page.screenshot({
    path: "../screenshots/01-catalog-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Search products").fill("mouse");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await page.getByLabel("Search products").fill("no such product");
  await expect(
    page.getByRole("heading", { name: "No essentials found." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: "Audio", exact: true }).click();
  await expect(page.locator(".product-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "All essentials", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../screenshots/04-catalog-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("five mice checkout creates a three-plus-two split with two lots", async ({
  page,
}) => {
  await splitCheckout(page);
  await page.screenshot({
    path: "../screenshots/05-checkout-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Place sample order", exact: true })
    .click();
  await expect(
    page.getByText("ORDER FW-1042 / SAMPLE CONFIRMATION"),
  ).toBeVisible();
  await expect(page.locator(".shipment-card")).toHaveCount(2);
  await expect(page.getByText("Quantity 3", { exact: true })).toBeVisible();
  await expect(page.getByText("Quantity 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Lot DEMO-p1-1 · Sample trace")).toBeVisible();
  await expect(page.getByText("Lot DEMO-p1-2 · Sample trace")).toBeVisible();
  await page.screenshot({
    path: "../screenshots/02-split-confirmation-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "View order & tracking" }).click();
  await expect(
    page.getByRole("button", { name: "Cancel unshipped units (5)" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request a return", exact: true }),
  ).toBeDisabled();
});
test("stock conflict preserves cart and creates no order", async ({ page }) => {
  await splitCheckout(page);
  // Presentation controls stay expanded between screens.
  await page.getByLabel("Preview state").selectOption("error");
  await page
    .getByRole("button", { name: "Place sample order", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Stock changed");
  await page.getByRole("button", { name: "My orders", exact: true }).click();
  await expect(page.locator(".order-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Bag 5", exact: true }).click();
  await expect(page.getByLabel("Quantity for Arc Wireless Mouse")).toHaveValue(
    "5",
  );
});
test("delivered units cannot be canceled; returns are bounded to delivered shipment items", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("Presentation controls", { exact: true }).click();
  await page.getByRole("button", { name: "Open delivered sample" }).click();
  await expect(
    page.getByRole("button", { name: "Cancel unshipped units (2)" }),
  ).toBeVisible();
  await page.screenshot({
    path: "../screenshots/03-tracking-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Cancel unshipped units (2)" })
    .click();
  await page.getByLabel("Quantity to cancel").fill("2");
  await page
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect(
    page.getByText("5 ordered · 3 delivered · 2 canceled · 0 return requested"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Cancel unshipped/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Request a return", exact: true })
    .click();
  await page.getByLabel("Delivered shipment item").selectOption("p1:0");
  await page.getByLabel("Quantity", { exact: true }).fill("3");
  await page.getByLabel("Reason", { exact: true }).selectOption("not-working");
  await page.screenshot({
    path: "../screenshots/06-return-request-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Submit sample return request" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Return RMA-1038 requested for 3 unit(s)",
  );
  await expect(
    page.getByRole("button", { name: "Request a return", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("5 ordered · 3 delivered · 2 canceled · 3 return requested"),
  ).toBeVisible();
});

test("presentation board exports a PDF with local screenshot assets", async ({
  page,
}) => {
  const { pathToFileURL } = await import("node:url");
  const { resolve } = await import("node:path");
  await page.goto(pathToFileURL(resolve("../presentation.html")).href);
  await expect(page.locator(".slide")).toHaveCount(3);
  expect(
    await page
      .locator("img")
      .evaluateAll((images) =>
        images.every(
          (image) =>
            (image as HTMLImageElement).complete &&
            (image as HTMLImageElement).naturalWidth > 0,
        ),
      ),
  ).toBe(true);
  await page.pdf({
    path: "../customer-walkthrough.pdf",
    format: "A4",
    landscape: true,
    printBackground: true,
    preferCSSPageSize: true,
  });
});
