
export type TReportStatus = 'pending' | 'resolved';

export interface IReport {
  rideId:         string;
  reportedById:   string;
  reportedUserId: string;
  reason:         string;
  details?:       string;
  status:         TReportStatus;
  isDeleted:      boolean;
}
