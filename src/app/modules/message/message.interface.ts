
export type TMessageSenderRole = 'passenger' | 'driver';

export interface IMessage {
  rideId:     string;
  senderId:   string;
  receiverId: string;
  senderRole: TMessageSenderRole;
  message:    string;
  isRead:     boolean;
  isDeleted:  boolean;
}
