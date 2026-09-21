/**
 * الواجهة العامة لوحدة الطلبات — ADR-002.
 * الشحن وما بعد البيع يغيّران الحالة عبر `OrderLifecycleService` وحده:
 * لا وحدة تكتب `sub_orders.status` مباشرة.
 */
export { OrdersModule } from '../orders.module';
export { OrderLifecycleService, type ActorRef } from '../application/order-lifecycle.service';
export { OrderQueryService } from '../application/order-query.service';
export { OrderScheduler } from '../application/order-scheduler';
export {
  STATUS_LABELS,
  TransitionRejectedError,
  allowedFor,
  deriveParent,
  type SubOrderStatus,
  type TransitionActor,
} from '../domain/state-machine';
