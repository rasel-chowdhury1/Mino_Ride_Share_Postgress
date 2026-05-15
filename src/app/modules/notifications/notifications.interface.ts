
import { NotificationType } from '@prisma/client';

export interface INotification {
  userId:     string;
  receiverId: string;
  fullName?:  string;
  image?:     string;
  text:       string;
  photos?:    string[];
  type:       NotificationType;
  isRead:     boolean;
}
