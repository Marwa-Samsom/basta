/** الواجهة العامة لوحدة الإشعارات — ADR-002 */
export { NotificationsModule } from '../notifications.module';
export { NotificationsService } from '../application/notifications.service';
export { EVENTS, CHANNELS, DEFAULT_TEMPLATES, render, type Channel } from '../domain/templates';
export { OUTBOX_ROOT } from '../infrastructure/channels';
