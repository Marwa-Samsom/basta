/** الواجهة العامة لوحدة الإدارة — ADR-002 */
export { AdminModule } from '../admin.module';
export { AdminAlertsScheduler, DISPUTE_REASON_AR, DRIFT_LABELS, RETURN_STALL_DAYS } from '../application/admin-alerts.scheduler';
export { ReportsService } from '../application/reports.service';
export { PERMISSIONS, PERMISSION_CODES } from '../domain/permissions';
