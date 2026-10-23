const http = require('node:http');
const path = require('node:path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const BASE_URL = 'http://localhost:3000/api/v1';

async function request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(BASE_URL + path);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch {
                    parsed = data;
                }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });

        req.on('error', reject);
        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

async function run() {
    console.log('=== STARTING COMPLETE REFUND WORKFLOW E2E AUDIT ===\n');

    const customerEmail = `e2e_cust_${Date.now()}@test.com`;
    const adminEmail = `e2e_admin_${Date.now()}@test.com`;
    const password = 'Password123!';

    // Connect to MongoDB
    await mongoose.connect('mongodb://127.0.0.1:27017/mean-l2?replicaSet=rs0');
    const User = require('../model/user.model');

    // 1. Create customer account
    console.log('1. Creating test customer account:', customerEmail);
    const customerUser = await User.create({
        name: 'E2E Customer',
        email: customerEmail,
        password,
        role: 'user'
    });
    const customerToken = jwt.sign(
        { id: customerUser._id.toString(), tokenVersion: Number(customerUser.tokenVersion || 0) },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );
    const customerHeaders = { Authorization: `Bearer ${customerToken}` };
    console.log('   ✓ Customer created & authenticated');

    // 2. Create admin account
    console.log('2. Creating test admin account:', adminEmail);
    const adminUser = await User.create({
        name: 'E2E Admin',
        email: adminEmail,
        password,
        role: 'admin'
    });
    const adminToken = jwt.sign(
        { id: adminUser._id.toString(), tokenVersion: Number(adminUser.tokenVersion || 0) },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    console.log('   ✓ Admin created & authenticated');

    // 4. Customer adds product to cart
    console.log('4. Finding active product and adding to cart...');
    const prodRes = await request('GET', '/product?page=1&pageSize=1');
    const product = prodRes.body.data[0];
    if (!product) throw new Error('No product found');
    console.log(`   Found product: "${product.name}" (${product._id})`);

    const variantId = product.variants && product.variants.length > 0 ? product.variants[0]._id : undefined;
    const cartAdd = await request('POST', '/cart', {
        product: product._id,
        quantity: 1,
        variantId
    }, customerHeaders);
    if (cartAdd.status !== 200 && cartAdd.status !== 201) throw new Error(`Add to cart failed: ${JSON.stringify(cartAdd.body)}`);
    console.log('   ✓ Product added to customer cart');

    // 5. Checkout COD
    console.log('5. Checking out order with COD delivery...');
    const checkoutKey = `chk-${Date.now()}`;
    const checkoutRes = await request('POST', '/order/checkout', {
        deliveryDetails: {
            name: 'E2E Customer',
            address: '123 Nile Street, Building 4',
            phone: '01012345678'
        }
    }, { ...customerHeaders, 'Idempotency-Key': checkoutKey });
    if (checkoutRes.status !== 201) throw new Error(`Checkout failed: ${JSON.stringify(checkoutRes.body)}`);
    const order = checkoutRes.body.data;
    console.log(`   ✓ Order created: #${order._id} (Status: ${order.orderStatus}, Payment: ${order.paymentStatus}, Total: ${order.total} EGP)`);

    // 6. Create COD Payment record
    console.log('6. Creating COD Payment record...');
    const payKey = `pay-${Date.now()}`;
    const payRes = await request('POST', '/payment', {
        order: order._id,
        method: 'cash_on_delivery'
    }, { ...customerHeaders, 'Idempotency-Key': payKey });
    if (payRes.status !== 201 && payRes.status !== 200) throw new Error(`Payment creation failed: ${JSON.stringify(payRes.body)}`);
    const payment = payRes.body.data;
    console.log(`   ✓ Payment created: #${payment._id} (Status: ${payment.status}, Method: ${payment.method})`);

    // 7. Verify unpaid payment cannot be refunded
    console.log('7. Verifying unpaid payment cannot be refunded...');
    const invalidRefundRes = await request('POST', '/refunds', {
        payment: payment._id,
        amount: 50,
        reason: 'Attempt on unpaid payment'
    }, { ...customerHeaders, 'Idempotency-Key': `ref-invalid-${Date.now()}` });
    if (invalidRefundRes.status !== 409) {
        throw new Error(`Expected 409 Conflict for unpaid refund, got ${invalidRefundRes.status}`);
    }
    console.log('   ✓ Correctly rejected refund for unpaid payment (409 Conflict)');

    // Verify eligible payments query filters it out
    const myPayments = await request('GET', '/payment', null, customerHeaders);
    const eligibleBefore = myPayments.body.data.filter(p => ['succeeded', 'partially_refunded'].includes(p.status));
    if (eligibleBefore.some(p => p._id === payment._id)) {
        throw new Error('Unpaid payment unexpectedly found in eligible payments list!');
    }
    console.log('   ✓ Verified unpaid payment is excluded from eligible payments filter');

    // 8. Security verification: Customer cannot confirm payment (admin endpoint)
    console.log('8. Testing RBAC: Customer calling admin COD confirmation endpoint...');
    const custConfirm = await request('PATCH', `/payment/${payment._id}/confirm-cash-on-delivery`, {}, customerHeaders);
    if (custConfirm.status !== 403) throw new Error(`Expected 403 for non-admin COD confirm, got ${custConfirm.status}`);
    console.log('   ✓ Non-admin customer forbidden from confirming COD payment (403)');

    // 9. Admin workflow: Move order to processing, then confirm COD payment
    console.log('9. Admin moving order to processing and confirming COD payment...');
    const statusRes = await request('PATCH', `/order/${order._id}/status`, { status: 'processing' }, adminHeaders);
    if (statusRes.status !== 200) throw new Error(`Admin status transition failed: ${JSON.stringify(statusRes.body)}`);
    console.log('   ✓ Admin updated order to processing');

    const adminConfirm = await request('PATCH', `/payment/${payment._id}/confirm-cash-on-delivery`, {}, adminHeaders);
    if (adminConfirm.status !== 200) throw new Error(`Admin COD confirm failed: ${JSON.stringify(adminConfirm.body)}`);
    const confirmedPayment = adminConfirm.body.data;
    if (confirmedPayment.status !== 'succeeded') throw new Error(`Payment status is not succeeded: ${confirmedPayment.status}`);
    console.log(`   ✓ COD payment confirmed by admin (Status: ${confirmedPayment.status})`);

    // 10. Check customer eligible payments now
    console.log('10. Checking customer eligible payments after COD confirmation...');
    const myPaymentsAfter = await request('GET', '/payment', null, customerHeaders);
    const eligibleAfter = myPaymentsAfter.body.data.filter(p => ['succeeded', 'partially_refunded'].includes(p.status));
    const isNowEligible = eligibleAfter.some(p => p._id === payment._id);
    if (!isNowEligible) throw new Error('Confirmed payment not present in eligible payments list!');
    console.log('   ✓ Confirmed payment is now eligible for refund');

    // 11. Customer requests partial refund
    console.log('11. Customer creating refund request...');
    const refundKey = `ref-valid-${Date.now()}`;
    const refundAmount = Math.min(50, payment.amount);
    const refundReason = 'Fabric quality did not match description';
    const createRefundRes = await request('POST', '/refunds', {
        payment: payment._id,
        amount: refundAmount,
        reason: refundReason
    }, { ...customerHeaders, 'Idempotency-Key': refundKey });
    if (createRefundRes.status !== 201) throw new Error(`Create refund failed: ${JSON.stringify(createRefundRes.body)}`);
    const refund = createRefundRes.body.data;
    console.log(`   ✓ Refund created: #${refund._id} (Status: ${refund.status}, Amount: ${refund.amount} EGP)`);

    // 12. Idempotent retry with same key
    console.log('12. Testing idempotency: Submitting duplicate request with same key...');
    const dupRefundRes = await request('POST', '/refunds', {
        payment: payment._id,
        amount: refundAmount,
        reason: refundReason
    }, { ...customerHeaders, 'Idempotency-Key': refundKey });
    if (dupRefundRes.status !== 200 || dupRefundRes.body.data._id !== refund._id) {
        throw new Error('Idempotent retry failed or returned different refund');
    }
    console.log('   ✓ Idempotent retry returned existing refund with 200 OK');

    // 13. Second concurrent refund on same payment with different key rejected
    console.log('13. Testing concurrency protection: Attempting second active refund on same payment...');
    const secondRefundRes = await request('POST', '/refunds', {
        payment: payment._id,
        amount: 10,
        reason: 'Second refund attempt'
    }, { ...customerHeaders, 'Idempotency-Key': `ref-diff-${Date.now()}` });
    if (secondRefundRes.status !== 409) {
        throw new Error(`Expected 409 Conflict for concurrent active refund, got ${secondRefundRes.status}`);
    }
    console.log('   ✓ Concurrent active refund request correctly rejected (409 Conflict)');

    // 14. Customer B isolation test: Customer B cannot access or refund Customer A's payment
    console.log('14. Testing cross-tenant isolation: Customer B attempting refund on Customer A payment...');
    const custBEmail = `e2e_custb_${Date.now()}@test.com`;
    const custBUser = await User.create({ name: 'Customer B', email: custBEmail, password, role: 'user' });
    const bToken = jwt.sign(
        { id: custBUser._id.toString(), tokenVersion: Number(custBUser.tokenVersion || 0) },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );
    const bHeaders = { Authorization: `Bearer ${bToken}` };

    const crossRefundRes = await request('POST', '/refunds', {
        payment: payment._id,
        amount: 10,
        reason: 'Unauthorized attempt'
    }, { ...bHeaders, 'Idempotency-Key': `ref-b-${Date.now()}` });
    if (crossRefundRes.status !== 404) {
        throw new Error(`Expected 404 for cross-customer payment refund, got ${crossRefundRes.status}`);
    }
    console.log('   ✓ Cross-tenant refund attempt rejected with 404 (Payment not found)');

    // 15. Admin views refunds
    console.log('15. Admin viewing all refund requests...');
    const adminRefundsRes = await request('GET', '/refunds/admin', null, adminHeaders);
    if (adminRefundsRes.status !== 200) throw new Error(`Admin get refunds failed: ${JSON.stringify(adminRefundsRes.body)}`);
    const foundAdminRefund = adminRefundsRes.body.data.find(r => r._id === refund._id);
    if (!foundAdminRefund) throw new Error('Created refund not found in admin list');
    console.log('   ✓ Refund request visible in admin panel');

    // 16. Admin approves refund
    console.log('16. Admin approving refund request...');
    const reviewRes = await request('PATCH', `/refunds/${refund._id}/review`, {
        decision: 'approve',
        reviewNote: 'Approved after inspecting customer feedback.'
    }, adminHeaders);
    if (reviewRes.status !== 200 || reviewRes.body.data.status !== 'approved') {
        throw new Error(`Review approval failed: ${JSON.stringify(reviewRes.body)}`);
    }
    console.log('   ✓ Refund approved by admin (Status: approved)');

    // 17. Admin starts processing
    console.log('17. Admin moving refund to processing...');
    const processRes = await request('PATCH', `/refunds/${refund._id}/process`, {}, adminHeaders);
    if (processRes.status !== 200 || processRes.body.data.status !== 'processing') {
        throw new Error(`Move to processing failed: ${JSON.stringify(processRes.body)}`);
    }
    console.log('   ✓ Refund moved to processing');

    // 18. Admin complete validation: missing providerRefundId rejected
    console.log('18. Verifying provider confirmation reference is required on complete...');
    const badComplete = await request('PATCH', `/refunds/${refund._id}/complete`, {}, adminHeaders);
    if (badComplete.status !== 400) throw new Error(`Expected 400 when missing providerRefundId, got ${badComplete.status}`);
    console.log('   ✓ Completion without confirmation reference rejected (400)');

    // 19. Admin completes refund
    console.log('19. Admin completing refund with reference...');
    const completeRes = await request('PATCH', `/refunds/${refund._id}/complete`, {
        providerRefundId: `COD-REFUND-${Date.now()}`
    }, adminHeaders);
    if (completeRes.status !== 200 || completeRes.body.data.status !== 'completed') {
        throw new Error(`Complete failed: ${JSON.stringify(completeRes.body)}`);
    }
    console.log('   ✓ Refund completed successfully (Status: completed)');

    // 20. Customer views refund history
    console.log('20. Customer viewing updated refund history...');
    const custHistory = await request('GET', '/refunds', null, customerHeaders);
    if (custHistory.status !== 200) throw new Error('Failed to retrieve customer refund history');
    const customerRefundRecord = custHistory.body.data.find(r => r._id === refund._id);
    if (!customerRefundRecord || customerRefundRecord.status !== 'completed') {
        throw new Error(`Customer history record mismatch: ${JSON.stringify(customerRefundRecord)}`);
    }
    console.log(`   ✓ Customer sees completed refund #${customerRefundRecord._id} with status: ${customerRefundRecord.status}`);

    console.log('\n=== ALL 20 REFUND WORKFLOW AUDIT CHECKS PASSED ===\n');
}

run().catch(err => {
    console.error('\n❌ AUDIT FAILED:', err);
    process.exit(1);
}).finally(() => {
    mongoose.disconnect().catch(() => {});
});
