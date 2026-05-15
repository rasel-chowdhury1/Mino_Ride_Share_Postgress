
export interface IFeedback {
  userId:         string;
  rating:         number;
  text:           string;
  adminVerified?: string;
  isDeleted?:     boolean;
}

export interface IUpdateFeedback {
  text?: string;
}
