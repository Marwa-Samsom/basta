/**
 * القوالب الإنجليزية — نظيرة DEFAULT_TEMPLATES قالباً قالباً، بالمتغيّرات نفسها (اختبار
 * templates.spec يقارنها). بها يصل الإشعار والبريد من لغة حسابه الإنجليزية (users.locale) —
 * بطلب صاحبة المشروع «بدي كل اشي يمشي حسب اللغة» (4 نوفمبر 2026). تُزرع بالقاعدة كالعربية
 * (locale = 'en') وتُحرَّر من AD-20؛ ما غاب منها يصل بالعربية.
 *
 * Style: plain and short — the news first, then what the reader can do. No exclamation marks
 * and no “Dear customer”. Customers are greeted by name; stores are written to as a team.
 */
import type { TemplateSeed } from './templates';

const t = (code: string, channel: TemplateSeed['channel'], body: string, subject: string | null = null): TemplateSeed => ({ code, channel, subject, body });

export const DEFAULT_TEMPLATES_EN: readonly TemplateSeed[] = [
  // ---------------------------------------------------------------- المشتري
  t('order_placed', 'email',
    'Hi {{name}},\n\nWe received your order {{order_number}} and your payment of {{amount}}. It comes from {{store_count}} stores, and each store ships and tracks its part separately.\n\nTrack your order here: {{link}}\n\nBasta',
    'Your order {{order_number}} is confirmed'),
  t('order_placed', 'sms', 'Basta: your order {{order_number}} is confirmed for {{amount}}. Track it from your account.'),
  t('order_placed', 'in_app', 'Your order {{order_number}} is confirmed — {{amount}}.'),

  t('order_status_changed', 'email',
    'Hi {{name}},\n\nWhat you ordered from {{store_name}} in order {{order_number}} is now: {{status}}.\n\nDetails and tracking: {{link}}\n\nBasta',
    'Your order {{order_number}}: {{status}}'),
  t('order_status_changed', 'push', '{{store_name}}: {{status}} — order {{order_number}}'),
  t('order_status_changed', 'in_app', '{{store_name}}: {{status}} for order {{order_number}}.'),

  t('order_shipped', 'email',
    'Hi {{name}},\n\n{{store_name}} has shipped what you ordered in order {{order_number}}.\n\n{{tracking_label}}: {{tracking_number}}\n\nDetails and tracking: {{link}}\n\nBasta',
    'Your order {{order_number}} has shipped'),
  t('order_shipped', 'push', '{{store_name}}: shipped — {{tracking_label}} {{tracking_number}}'),
  t('order_shipped', 'in_app', '{{store_name}} shipped your order {{order_number}} — {{tracking_label}}: {{tracking_number}}.'),

  t('order_canceled', 'email',
    'Hi {{name}},\n\nWhat you ordered from {{store_name}} in order {{order_number}} was canceled. Reason: {{reason}}.\n\nIts full amount is refunded to your payment method, and the rest of your order continues as it is.\n\n{{link}}\n\nBasta',
    'Part of your order {{order_number}} was canceled'),
  t('order_canceled', 'sms', 'Basta: your items from {{store_name}} in {{order_number}} were canceled and will be fully refunded.'),
  t('order_canceled', 'in_app', 'Your order from {{store_name}} ({{order_number}}) was canceled and will be fully refunded.'),

  t('return_rejected', 'email',
    'Hi {{name}},\n\n{{store_name}} declined the return request for order {{order_number}}. Reason: “{{reason}}”.\n\nIf you disagree, open “I have a problem” on the order page and we will review it with you.\n\n{{link}}\n\nBasta',
    'Return request declined for {{order_number}}'),
  t('return_rejected', 'in_app', '{{store_name}} declined the return request for {{order_number}}. Reason: “{{reason}}”.'),

  t('refund_issued', 'email',
    'Hi {{name}},\n\nWe refunded {{amount}} to your payment method for order {{order_number}}. It may take a few business days to appear on your card statement, depending on your bank.\n\n{{link}}\n\nBasta',
    'Refund of {{amount}} for order {{order_number}}'),
  t('refund_issued', 'in_app', 'We refunded {{amount}} to your payment method for order {{order_number}}.'),

  t('order_awaiting_transfer', 'email',
    'Hi {{name}},\n\nWe have reserved your order {{order_number}}; only the transfer is left. Transfer exactly {{amount}} to:\n\n{{pay_to}}\n\nand write the order number {{order_number}} in the transfer note so we know it is yours.\n\nYour items are reserved until {{deadline}}. Once we confirm your transfer has arrived we send the order to the stores and let you know. If it does not arrive by then, the order is canceled automatically.\n\nDetails and cancellation: {{link}}\n\nBasta',
    'Transfer {{amount}} to confirm your order {{order_number}}'),
  t('order_awaiting_transfer', 'in_app', 'Your order {{order_number}} is reserved until {{deadline}} — transfer {{amount}} and write the order number in the transfer note.'),

  t('transfer_expired', 'email',
    'Hi {{name}},\n\nYour order {{order_number}} was canceled because its transfer did not reach us within {{hours}} hours, and the items went back to the store.\n\nIf you did transfer, send us the transfer reference and we will return it to you, or place the order again.\n\n{{link}}\n\nBasta',
    'Your order {{order_number}} was canceled — the transfer did not arrive'),
  t('transfer_expired', 'in_app', 'Your order {{order_number}} was canceled: its transfer did not arrive within {{hours}} hours.'),

  t('refund_transferred', 'email',
    'Hi {{name}},\n\nWe transferred {{amount}} to you for order {{order_number}}. Transfer reference: {{reference}}.\n\nIt may take a business day to appear in your account, depending on your bank.\n\n{{link}}\n\nBasta',
    'We transferred {{amount}} to you for order {{order_number}}'),
  t('refund_transferred', 'in_app', 'We transferred {{amount}} to you for order {{order_number}} — transfer reference {{reference}}.'),

  t('late_payment_refunded', 'email',
    'Your payment for order {{order_number}} was confirmed after the order had already closed without completing, so the order was not created.\n\nWe refunded the full amount, {{amount}}, to your payment method. It may take a few business days to appear on your card statement, depending on your bank.\n\nIf you still want the products, please order them again.\n\nBasta',
    'We refunded {{amount}} for order {{order_number}}'),
  t('late_payment_refunded', 'in_app', 'Your payment for order {{order_number}} arrived after it closed, so we refunded the full {{amount}} to your payment method.'),

  t('dispute_message', 'email',
    'Hi {{name}},\n\nYou have a new message in the dispute on order {{order_number}}. Read it and reply here: {{link}}\n\nBasta',
    'New message in the dispute on order {{order_number}}'),
  t('dispute_message', 'in_app', 'New message in the dispute on order {{order_number}}.'),

  t('dispute_escalated', 'email',
    'Hi {{name}},\n\nThe dispute on order {{order_number}} was escalated to the Basta team for a decision. You will receive the decision and its reason here and by email. Until then you can add anything to the dispute that explains your side: {{link}}\n\nBasta',
    'The dispute on order {{order_number}} was escalated to Basta'),
  t('dispute_escalated', 'in_app', 'The dispute on order {{order_number}} was escalated to Basta for a decision.'),

  t('dispute_resolved', 'email',
    'Hi {{name}},\n\nThe Basta team resolved the dispute on order {{order_number}}: {{outcome}}.\n\nReason for the decision: {{resolution}}\n\nDetails: {{link}}\n\nBasta',
    'The dispute on order {{order_number}} is resolved'),
  t('dispute_resolved', 'in_app', 'The dispute on order {{order_number}} is resolved: {{outcome}}.'),

  // ---------------------------------------------------------------- الهوية والأمان
  t('email_verify_code', 'email',
    'Hi {{name}},\n\nYour Basta email confirmation code: {{code}}\n\nEnter it on the confirmation page you have open. It is valid for {{minutes}} minutes and can be used once.\n\nIf you did not request it, ignore this message; your account is unchanged.\n\nBasta',
    'Your Basta email confirmation code'),
  t('password_reset_code', 'email',
    'Hi {{name}},\n\nSomeone asked to reset the password of your Basta account. Your reset code: {{code}}\n\nEnter it on the reset page with your new password. It is valid for {{minutes}} minutes and can be used once, and using it signs you out of all your open sessions.\n\nIf you did not request it, ignore this message; your password has not changed.\n\nBasta',
    'Password reset code'),
  t('recovery_code_used', 'email',
    'One of your recovery codes was just used to sign in to your Basta account instead of an authenticator code. Codes left: {{left}}.\n\nIf it was you, there is nothing to do; create new codes from the security page if you are running low.\n\nIf it was not you, change your password now and end your other sessions from your account page.\n\nBasta',
    'A recovery code was used to sign in to your account'),
  t('recovery_code_used', 'in_app', 'A recovery code was used to sign in to your account. Codes left: {{left}}.'),
  t('totp_rotated', 'email',
    'Two-step verification on your Basta account was linked to a new authenticator device, new recovery codes were issued that cancel the old ones, and all your sessions were ended.\n\nIf it was you, there is nothing to do.\n\nIf it was not you, someone else knows your password and code: reset your password now and contact us.\n\nBasta',
    'Your two-step verification device changed'),
  t('totp_rotated', 'in_app', 'Two-step verification was linked to a new device and new recovery codes were issued. If it was not you, contact us now.'),
  t('totp_reset_by_admin', 'email',
    'The support team reset two-step verification on your Basta account and ended all your sessions. Reason: {{reason}}\n\nYour account now opens with your password alone — turn two-step verification on again from the security page.\n\nIf you did not ask for this, contact us now.\n\nBasta',
    'Two-step verification on your account was reset'),
  t('totp_reset_by_admin', 'in_app', 'Support reset two-step verification on your account. Turn it on again from the security page.'),

  // ---------------------------------------------------------------- البائع
  t('vendor_new_order', 'email',
    '{{store_name}} team,\n\nYou have a new order {{order_number}} worth {{amount}}. Accept or decline it within {{deadline_hours}} hours, or it is canceled automatically and the buyer is refunded.\n\n{{link}}\n\nBasta',
    'New order {{order_number}}'),
  t('vendor_new_order', 'whatsapp', 'Basta: new order {{order_number}} worth {{amount}} for {{store_name}}. Accept it within {{deadline_hours}} hours from the seller dashboard.'),
  t('vendor_new_order', 'in_app', 'New order {{order_number}} — {{amount}}. Deadline: {{deadline_hours}} hours.'),

  t('vendor_order_canceled', 'email',
    '{{store_name}} team,\n\nOrder {{order_number}} was canceled. Reason: {{reason}}.\n\nThe buyer was refunded and its items went back to your stock, so do not prepare or ship it.\n\n{{link}}\n\nBasta',
    'Order {{order_number}} was canceled'),
  t('vendor_order_canceled', 'in_app', 'Order {{order_number}} was canceled: {{reason}}. Do not prepare it.'),

  t('return_requested', 'email',
    '{{store_name}} team,\n\nThe buyer asked to return items from order {{order_number}}. Reason: {{reason}}.\n\nWhen you receive the items, confirm it from the dashboard; they go back to stock and the buyer is refunded for them.\n\n{{link}}\n\nBasta',
    'Return request on {{order_number}}'),
  t('return_requested', 'in_app', 'Return request on {{order_number}}: {{reason}}.'),

  t('vendor_dispute_opened', 'email',
    '{{store_name}} team,\n\nThe buyer opened a dispute on order {{order_number}}. Reason: {{reason}}.\n\nThe money for this order is on hold until the dispute is resolved. Read their message and reply here; if you cannot agree, either of you can escalate it to Basta: {{link}}\n\nBasta',
    'Dispute on order {{order_number}}'),
  t('vendor_dispute_opened', 'in_app', 'Dispute on order {{order_number}}: {{reason}}. Its money is on hold until it is resolved.'),

  t('vendor_dispute_escalated', 'email',
    '{{store_name}} team,\n\nThe dispute on order {{order_number}} was escalated to the Basta team for a decision. You will receive the decision and its reason here and by email. Until then you can add anything to the dispute that explains your side: {{link}}\n\nBasta',
    'The dispute on order {{order_number}} was escalated to Basta'),
  t('vendor_dispute_escalated', 'in_app', 'The dispute on order {{order_number}} was escalated to Basta for a decision.'),

  t('vendor_dispute_resolved', 'email',
    '{{store_name}} team,\n\nThe Basta team resolved the dispute on order {{order_number}}: {{outcome}}.\n\nReason for the decision: {{resolution}}\n\nDetails: {{link}}\n\nBasta',
    'The dispute on order {{order_number}} is resolved'),
  t('vendor_dispute_resolved', 'in_app', 'The dispute on order {{order_number}} is resolved: {{outcome}}.'),

  t('vendor_dispute_withdrawn', 'email',
    '{{store_name}} team,\n\nThe buyer withdrew the dispute on order {{order_number}}, so it closed without a decision. The order money is no longer on hold; the order completes and its money is released on schedule.\n\nDetails: {{link}}\n\nBasta',
    'The buyer withdrew the dispute on order {{order_number}}'),
  t('vendor_dispute_withdrawn', 'in_app', 'The buyer withdrew the dispute on order {{order_number}}. Its money is no longer on hold and is released on schedule.'),

  // ---------------------------------------------------------------- الإدارة
  t('admin_dispute_escalated', 'email',
    'A dispute on order {{order_number}} from {{store_name}} was escalated to the team. Buyer’s reason: {{reason}}.\n\nThe order money is on hold until it is resolved. Read the thread and decide here: {{link}}\n\nBasta',
    'Escalated dispute on {{order_number}}'),
  t('admin_dispute_escalated', 'in_app', 'Escalated dispute on {{order_number}} ({{store_name}}): {{reason}}. Waiting for your decision.'),

  t('admin_dispute_waiting', 'email',
    'The dispute on order {{order_number}} from {{store_name}} is escalated to the team, and no one from the team has replied for {{days}} days. Buyer’s reason: {{reason}}.\n\nThe buyer is waiting, and the order money is on hold until it is resolved. Reply or decide here: {{link}}\n\nBasta',
    'Dispute {{order_number}} has waited for your reply for {{days}} days'),
  t('admin_dispute_waiting', 'in_app', 'Dispute {{order_number}} ({{store_name}}) has waited for a team reply for {{days}} days: {{reason}}.'),

  t('admin_payout_requested', 'email',
    '{{store_name}} asked to withdraw {{amount}} to its verified bank account.\n\nApprove or reject it here: {{link}}\n\nBasta',
    'Payout request of {{amount}} from {{store_name}}'),
  t('admin_payout_requested', 'in_app', 'Payout request of {{amount}} from {{store_name}} is waiting for your approval.'),

  t('admin_vendor_submitted', 'email',
    '{{store_name}} {{kind}}. Its documents and bank account are ready for review.\n\nIt cannot sell before it is approved. Review it here: {{link}}\n\nBasta',
    '{{store_name}} is waiting for review'),
  t('admin_vendor_submitted', 'in_app', '{{store_name}} {{kind}} — waiting for your review.'),

  t('admin_bank_account_added', 'email',
    '{{store_name}} added a new bank account ({{bank_name}}, ending in {{iban_tail}}).\n\nNothing is transferred to it until someone on the team verifies it. Verify it from the store page: {{link}}\n\nBasta',
    'New bank account for {{store_name}} awaits verification'),
  t('admin_bank_account_added', 'in_app', 'New bank account for {{store_name}} ({{bank_name}} …{{iban_tail}}) awaits your verification.'),

  t('admin_transfer_awaiting', 'email',
    'Order {{order_number}} for {{amount}} was paid by bank transfer and is waiting for you to confirm the money reached the platform account.\n\nIt does not reach the stores before it is confirmed, and it is canceled automatically if the transfer does not arrive within {{hours}} hours. Confirm it here: {{link}}\n\nBasta',
    'The transfer for order {{order_number}} awaits confirmation'),
  t('admin_transfer_awaiting', 'in_app', 'Order {{order_number}} ({{amount}}) awaits confirmation that its transfer arrived — canceled after {{hours}} hours.'),

  t('admin_refund_awaiting_transfer', 'email',
    'A refund of {{amount}} to the buyer for order {{order_number}} is not sent automatically, because the order was paid by bank transfer.\n\nTransfer it to the buyer and record the transfer reference here: {{link}}\n\nBasta',
    'A refund of {{amount}} awaits your transfer'),
  t('admin_refund_awaiting_transfer', 'in_app', 'A refund of {{amount}} for order {{order_number}} is waiting for you to transfer it to the buyer.'),

  t('admin_dispute_message', 'email',
    '{{sender}} wrote a new message in the escalated dispute on order {{order_number}}.\n\nRead it before you decide: {{link}}\n\nBasta',
    'New message in dispute {{order_number}}'),
  t('admin_dispute_message', 'in_app', 'New message from {{sender}} in the escalated dispute on {{order_number}}.'),

  t('admin_dispute_withdrawn', 'email',
    'The buyer withdrew the escalated dispute on order {{order_number}} from {{store_name}}, so it closed without a decision and no longer needs yours.\n\nThread: {{link}}\n\nBasta',
    'The escalated dispute on {{order_number}} was withdrawn'),
  t('admin_dispute_withdrawn', 'in_app', 'The buyer withdrew the escalated dispute on {{order_number}} ({{store_name}}). It no longer needs your decision.'),

  t('admin_return_stalled', 'email',
    'The return for order {{order_number}} from {{store_name}} has not been marked received for {{days}} days.\n\nThe buyer is waiting for a refund, and the order money is not released to the store while the return is open. Follow up with the store, or record the receipt on its behalf: {{link}}\n\nBasta',
    'Return {{order_number}} stuck for {{days}} days'),
  t('admin_return_stalled', 'in_app', 'Return {{order_number}} ({{store_name}}) not received for {{days}} days.'),

  t('admin_acceptance_due', 'email',
    'Order {{order_number}} has not been accepted by {{store_name}} yet. It is canceled and refunded automatically within {{hours}} hours.\n\nRemind the store or act here: {{link}}\n\nBasta',
    'Order {{order_number}} is near its acceptance deadline'),
  t('admin_acceptance_due', 'in_app', 'Order {{order_number}} ({{store_name}}) is not accepted — canceled automatically within {{hours}} hours.'),

  t('admin_audit_drift', 'email',
    'The periodic money check found a drift: {{check}} — {{rows}} rows.\n\nThis is a fault in the ledger or the stock and must not be left. Check it now from the admin dashboard: {{link}}\n\nBasta',
    'Money check drift: {{check}}'),
  t('admin_audit_drift', 'in_app', 'Money check drift: {{check}} — {{rows}} rows. Check it now.'),

  // ---------------------------------------------------------------- مال البائع ومتجره
  t('payout_paid', 'email',
    '{{store_name}} team,\n\nWe transferred {{amount}} to your bank account. Transfer reference: {{reference}}.\n\nStatement: {{link}}\n\nBasta',
    '{{amount}} was transferred to your account'),
  t('payout_paid', 'in_app', '{{amount}} transferred — reference {{reference}}.'),

  t('payout_rejected', 'email',
    '{{store_name}} team,\n\nWe could not complete your payout request of {{amount}}. Reason: {{reason}}.\n\nThe amount went back to your available balance right away, and you can request it again once it is fixed.\n\n{{link}}\n\nBasta',
    'Your payout request was not completed'),
  t('payout_rejected', 'in_app', 'Payout request of {{amount}} rejected: {{reason}}. The amount went back to your available balance.'),

  t('vendor_approved', 'email',
    '{{store_name}} team,\n\nWe approved your store on Basta. Add your products now; they appear to buyers as soon as you publish them.\n\n{{link}}\n\nBasta',
    'Your store on Basta is approved'),
  t('vendor_approved', 'in_app', 'Your store is approved. Add your products now.'),

  t('vendor_rejected', 'email',
    '{{store_name}} team,\n\nWe reviewed your application and have not approved it yet. Reason: {{reason}}.\n\nFix what is needed and resubmit here: {{link}}\n\nBasta',
    'Your application needs changes'),
  t('vendor_rejected', 'in_app', 'Your application needs changes: {{reason}}.'),

  t('vendor_document_rejected', 'email',
    '{{store_name}} team,\n\nWe reviewed the document “{{document}}” in your application and could not accept it. Reason: {{reason}}.\n\nUpload it again here and it goes back to review; your application keeps its place: {{link}}\n\nBasta',
    'The document “{{document}}” in your application was rejected'),
  t('vendor_document_rejected', 'in_app', 'The document “{{document}}” was rejected: {{reason}}. Upload it again.'),

  t('product_rejected', 'email',
    '{{store_name}} team,\n\nWe stopped showing the product “{{product_name}}” in the store. Reason: {{reason}}.\n\nEdit it and publish it again: {{link}}\n\nBasta',
    'We stopped showing “{{product_name}}”'),
  t('product_rejected', 'in_app', '“{{product_name}}” is no longer shown: {{reason}}.'),

  t('low_stock', 'email',
    '{{store_name}} team,\n\nThese products are running low: {{items}}.\n\nAdd stock before they run out and stop selling: {{link}}\n\nBasta',
    'Low stock at {{store_name}}'),
  t('low_stock', 'in_app', 'Low stock: {{items}}.'),

  t('message_to_vendor', 'email',
    '{{store_name}} team,\n\n{{customer_name}} wrote to you about {{context}}:\n\n“{{preview}}”\n\nReplying within a business day keeps the buyer with you: {{link}}\n\nBasta',
    'Message from {{customer_name}} — {{context}}'),
  t('message_to_vendor', 'in_app', 'Message from {{customer_name}} about {{context}}: {{preview}}'),

  t('bank_account_added', 'email',
    '{{store_name}} team,\n\nA new bank account at {{bank}} ending in {{iban_tail}} was added to your store. No money is transferred to it until the Basta team verifies it.\n\nIf you did not add it, change your password now, end your other sessions, and contact us: {{link}}\n\nBasta',
    'A bank account was added to your store'),
  t('bank_account_added', 'in_app', 'A bank account at {{bank}} ending in {{iban_tail}} was added — awaiting verification.'),

  t('bank_account_verified', 'email',
    '{{store_name}} team,\n\nWe verified your account at {{bank}} ending in {{iban_tail}}. You can now make it the default account for payouts: {{link}}\n\nBasta',
    'Your bank account is verified'),
  t('bank_account_verified', 'in_app', 'Your account at {{bank}} ending in {{iban_tail}} is verified.'),

  t('message_to_customer', 'email',
    '{{store_name}} replied to your message about {{context}}:\n\n“{{preview}}”\n\nRead the whole conversation and reply here: {{link}}\n\nBasta',
    'Reply from {{store_name}}'),
  t('message_to_customer', 'in_app', '{{store_name}} replied about {{context}}: {{preview}}'),
];
