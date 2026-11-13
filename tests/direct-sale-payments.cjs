const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const vm = require('node:vm');

const agenda = fs.readFileSync('modules/agenda.html', 'utf8');
const mixedRuntime = agenda.match(/<script>([\s\S]*?)<\/script>/)[1];
const saleRuntime = agenda.match(/<script id="atlas-v136-direct-sale">([\s\S]*?)<\/script>/)[1];
const styles = '<style>*{box-sizing:border-box}body{font:14px Arial}.modalback{display:none}.modalback.open{display:flex}.modal{background:white;padding:20px}.actions{display:flex}.field{display:grid}.grid2{display:grid;grid-template-columns:1fr 1fr}.callout{padding:12px}.small{font-size:12px}</style>';

async function runSale(browser, method, amounts) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.route('**/*', route => route.abort());
  await page.setContent(styles);
  await page.evaluate(() => {
    window.patientMaster = [{ code: 'synthetic', name: 'Paciente ficticio', remoteId: 'synthetic-patient' }];
    window.sales = {};
    window.cashMovements = [];
    window.savedSales = [];
    window.persistCash = window.renderCash = () => {};
    window.alert = () => {};
    window.atlasCentralRequest = async (action, payload) => {
      if (action === 'settings:list') return [{ section: 'sales', payload: { products: [], services: [{ id: 'service-a', name: 'Servicio ficticio', price: 100 }], stockMovements: [] } }];
      if (action === 'sales:createPatientSale') {
        window.savedSales.push(payload);
        const lines = payload.lines.map(line => ({ ...line, description: line.catalogId, line_discount_percent: line.discountPercent, unit_price: line.unitPrice, amount: Math.round(line.quantity * line.unitPrice * (1 - line.discountPercent / 100) * 100) / 100 }));
        return { id: 'synthetic-payment', receipt_number: 1, invoice_number: 'SYNTHETIC-1', status: 'completed', amount: lines.reduce((sum, line) => sum + line.amount, 0), paid_at: '2026-11-13T12:00:00Z', metadata: { kind: 'direct_sale', invoice_lines: lines, payment_method_breakdown: payload.mixedBreakdown } };
      }
      throw new Error('Unexpected synthetic request');
    };
  });
  await page.addScriptTag({ content: mixedRuntime });
  await page.addScriptTag({ content: saleRuntime });
  await page.evaluate(() => dispatchEvent(new MessageEvent('message', { data: { type: 'atlas:open-direct-sale', patientCode: 'synthetic' } })));
  await page.locator('#atlasDirectSaleBack.open').waitFor();
  await page.locator('[data-row="0"] [data-catalog]').selectOption('service-a');
  await page.locator('[data-row="0"] [data-discount]').fill('10');
  await page.locator('#atlasDirectSaleMethod').selectOption(method);
  if (method === 'mixed') {
    const fields = page.locator('#directSaleMixedFields [data-atlas-mixed-row]');
    await fields.nth(0).locator('[data-atlas-mixed-method]').selectOption('cash');
    await fields.nth(0).locator('[data-atlas-mixed-amount]').fill(amounts[0]);
    await fields.nth(1).locator('[data-atlas-mixed-method]').selectOption('card');
    await fields.nth(1).locator('[data-atlas-mixed-amount]').fill(amounts[1]);
  }
  await page.locator('#atlasDirectSaleConfirm').click();
  await page.waitForFunction(() => window.savedSales.length === 1);
  const outcome = await page.evaluate(() => ({ sale: window.savedSales[0], cash: window.cashMovements[0] }));
  await page.close();
  return outcome;
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const card = await runSale(browser, 'card', []);
    assert.deepEqual(card.sale.mixedBreakdown, []);
    assert.equal(card.sale.lines[0].discountPercent, 10);
    assert.equal(card.cash.amount, 90);

    const mixed = await runSale(browser, 'mixed', ['50', '40']);
    assert.equal(mixed.sale.mixedBreakdown.length, 2);
    assert.equal(mixed.sale.mixedBreakdown.reduce((sum, part) => sum + part.amount, 0), 90);
    assert.deepEqual(mixed.sale.mixedBreakdown.map(part => part.method), ['cash', 'card']);
    assert.equal(mixed.cash.paymentMethodBreakdown.length, 2);
    const ficha = fs.readFileSync('modules/ficha.html', 'utf8');
    let printed = '';
    const invoiceFunction = ficha.match(/ function printInvoice\(invoice,context\)\{[^\n]+/)[0];
    const invoiceContext = { invEsc: String, invEuro: n => Number(n).toFixed(2), invoicePaidDate: () => '', paymentText: () => '', window: { open: () => ({ document: { write: html => { printed = html; }, close() {} } }) } };
    vm.createContext(invoiceContext);
    vm.runInContext(invoiceFunction + ';this.render=printInvoice', invoiceContext);
    invoiceContext.render({ lines: [{ description: 'Servicio A', quantity: 1, line_discount_percent: 10, total: 90 }, { description: 'Servicio B', quantity: 1, total: 80 }], total: 170, issue_date: '2026-11-13' }, {});
    assert.match(printed, /<th>Descuento<\/th>/);
    assert.match(printed, />10 %<\/td>/);
    assert.match(printed, />0 %<\/td>/);
    invoiceContext.render({ lines: [{ description: 'Servicio sin descuento', quantity: 1, total: 80 }], total: 80, issue_date: '2026-11-13' }, {});
    assert.doesNotMatch(printed, /<th>Descuento<\/th>/);
    for (const html of [agenda, ficha]) {
      for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (!/type=["']application\/json/.test(match[1])) new vm.Script(match[2]);
      }
    }
    console.log('Synthetic checks passed: standard and mixed sales, exact method breakdown and invoice discount display.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
