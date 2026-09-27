/** الواجهة العامة لوحدة الرسائل — ADR-002 */
export { MessagingModule } from '../messaging.module';
export {
  MessagingService,
  type ContextView,
  type MessageView,
  type ThreadRow,
  type ThreadView,
} from '../application/messaging.service';
export { BODY_MAX, BODY_MIN, PREVIEW_MAX } from '../domain/messages';
