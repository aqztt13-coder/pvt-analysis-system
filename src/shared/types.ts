export type UserRole = 'manager' | 'engineer' | 'viewer';

export type ModuleKey =
  | 'dashboard'
  | 'employees'
  | 'attendance'
  | 'equipment'
  | 'maintenance'
  | 'documents'
  | 'correspondence'
  | 'inventory'
  | 'requests'
  | 'meetings'
  | 'training'
  | 'safety'
  | 'notifications'
  | 'reports'
  | 'admin';

export interface AuthUser {
  id: number;
  username: string;
  fullNameAr: string;
  fullNameEn: string;
  role: UserRole;
  jobTitle: string;
  email: string;
  isActive: boolean;
  mustChangePassword?: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Employee {
  id: number;
  employeeCode: string;
  fullNameAr: string;
  fullNameEn: string;
  jobTitle: string;
  section: string;
  qualification: string;
  specialization: string;
  category: string;
  status: 'active' | 'on_leave' | 'seconded' | 'suspended' | 'retired';
  hireDate: string;
  birthDate?: string | null;
  phone: string;
  extension: string;
  email: string;
  workplace: string;
  jobDescription: string;
  emergencyContact?: string | null;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceRecord {
  id: number;
  employeeId: number;
  employeeName?: string;
  employeeCode?: string;
  workDate: string;
  status: 'present' | 'absent' | 'late' | 'on_leave' | 'mission' | 'holiday';
  checkIn: string;
  checkOut: string;
  notes: string;
  recordedBy: string;
  createdAt: string;
}

export interface OfficialHoliday {
  id: number;
  title: string;
  holidayDate: string;
  endDate: string;
  notes: string;
}

export interface LeaveTypeConfig {
  id: number;
  code: string;
  nameAr: string;
  nameEn?: string;
  annualAllowance: number;
  requiresAttachment: boolean;
  isActive: boolean;
}

export interface LeaveRequest {
  id: number;
  employeeId: number;
  employeeName?: string;
  employeeCode?: string;
  employeeJobTitle?: string;
  employeeSection?: string;
  leaveTypeCode: string;
  leaveTypeName?: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  destination: string;
  destinationCountry: string;
  destinationCity: string;
  travelNotes: string;
  submissionDate: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decisionNotes: string;
  decidedBy: string | null;
  decidedAt: string | null;
  fileId: number | null;
  fileName?: string | null;
  createdAt: string;
}

export interface EquipmentItem {
  id: number;
  equipmentCode: string;
  nameAr: string;
  nameEn: string;
  category: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  assetNumber: string;
  acquisitionDate: string;
  purchaseInfo: string;
  location: string;
  custodianId: number | null;
  custodianName?: string;
  status: 'operational' | 'under_maintenance' | 'out_of_service' | 'under_inspection' | 'retired';
  warrantyExpiry: string;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentTransfer {
  id: number;
  equipmentId: number;
  equipmentName?: string;
  fromLocation: string;
  toLocation: string;
  fromCustodian: string;
  toCustodian: string;
  transferDate: string;
  reason: string;
  recordedBy: string;
}

export interface MaintenanceRecord {
  id: number;
  workOrderNo: string;
  equipmentId: number;
  equipmentCode?: string;
  equipmentName?: string;
  maintenanceType: 'preventive' | 'corrective' | 'breakdown';
  requesterName: string;
  assignedTo: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  startDate: string;
  expectedEndDate: string;
  actualEndDate: string | null;
  description: string;
  spareParts: string;
  costAmount: number | null;
  status: 'scheduled' | 'open' | 'in_progress' | 'completed' | 'cancelled';
  notes: string;
  createdAt: string;
}

export interface CalibrationRecord {
  id: number;
  equipmentId: number;
  equipmentCode?: string;
  equipmentName?: string;
  calibrationDate: string;
  dueDate: string;
  provider: string;
  certificateNumber: string;
  inspectionDate: string;
  status: 'valid' | 'due_soon' | 'overdue' | 'failed';
  responsiblePerson: string;
  notes: string;
  fileId: number | null;
  fileName?: string | null;
  createdAt: string;
}

export interface DocumentRecord {
  id: number;
  docNumber: string;
  title: string;
  category: string;
  referenceNumber: string;
  creationDate: string;
  submissionDate: string;
  author: string;
  responsiblePerson: string;
  relatedEmployeeId: number | null;
  relatedEquipmentId: number | null;
  relatedEmployeeName?: string | null;
  relatedEquipmentName?: string | null;
  description: string;
  tags: string;
  status: 'draft' | 'under_review' | 'approved' | 'archived';
  revisionNo: number;
  approvedBy: string | null;
  approvedAt: string | null;
  reviewDueDate: string | null;
  fileId: number | null;
  fileName?: string | null;
  fileSize?: number | null;
  fileMime?: string | null;
  createdAt: string;
}

export interface CorrespondenceRecord {
  id: number;
  refNumber: string;
  correspondenceType: 'incoming' | 'outgoing' | 'internal_memo' | 'official_letter';
  subject: string;
  sender: string;
  recipient: string;
  receivedDate: string;
  dispatchDate: string;
  relatedDepartment: string;
  responsibleEmployee: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  requiredAction: string;
  dueDate: string;
  status: 'open' | 'in_progress' | 'completed' | 'archived';
  notes: string;
  fileId: number | null;
  fileName?: string | null;
  createdAt: string;
}

export interface InventoryCategory {
  id: number;
  nameAr: string;
  nameEn: string;
  isChemical: boolean;
  isActive: boolean;
}

export interface InventoryItem {
  id: number;
  itemCode: string;
  nameAr: string;
  nameEn: string;
  category: string;
  isChemical: boolean;
  description: string;
  manufacturer: string;
  grade: string;
  unit: string;
  quantity: number;
  containerCapacity: number | null;
  containerUnit: string;
  totalVolume: number | null;
  minStock: number;
  storageLocation: string;
  supplier: string;
  purchaseDate: string;
  expiryDate: string | null;
  responsiblePerson: string;
  notes: string;
  sdsFileId: number | null;
  sdsFileName?: string | null;
  docFileId: number | null;
  docFileName?: string | null;
  updatedAt: string;
}

export interface InventoryTransaction {
  id: number;
  itemId: number;
  itemCode?: string;
  itemName?: string;
  itemNameEn?: string;
  isChemical?: boolean;
  txType: 'receipt' | 'issue' | 'adjustment' | 'transfer';
  quantityDelta: number;
  balanceAfter: number;
  containersCount: number | null;
  containerCapacity: number | null;
  volumeDelta: number | null;
  totalVolumeAfter: number | null;
  volumeUnit: string;
  employeeName: string;
  fromLocation: string;
  toLocation: string;
  referenceNo: string;
  reason: string;
  performedBy: string;
  createdAt: string;
}

export interface AdminRequest {
  id: number;
  requestNumber: string;
  requestType: 'purchase' | 'equipment' | 'consumables' | 'maintenance' | 'administrative';
  title: string;
  requesterName: string;
  description: string;
  justification: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  submissionDate: string;
  status: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'completed';
  managerName: string | null;
  decisionNotes: string;
  createdAt: string;
}

export interface MeetingRecord {
  id: number;
  meetingNumber: string;
  title: string;
  meetingDate: string;
  location: string;
  agenda: string;
  attendees: string;
  minutes: string;
  decisions: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  createdBy: string;
  createdAt: string;
}

export interface TaskRecord {
  id: number;
  title: string;
  description: string;
  assignedTo: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  startDate: string;
  dueDate: string;
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  relatedMeetingId: number | null;
  completionNotes: string;
  createdBy: string;
  createdAt: string;
}

export interface TrainingRecord {
  id: number;
  courseTitle: string;
  provider: string;
  location: string;
  employeeId: number | null;
  employeeName: string;
  startDate: string;
  endDate: string;
  certificateNumber: string;
  competencyArea: string;
  status: 'planned' | 'enrolled' | 'completed' | 'cancelled';
  notes: string;
  createdAt: string;
}

export interface SafetyRecord {
  id: number;
  recordNumber: string;
  recordType: 'inspection' | 'observation' | 'incident' | 'ppe_distribution' | 'safety_training';
  title: string;
  recordDate: string;
  location: string;
  responsibleEmployee: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  correctiveAction: string;
  followUpStatus: 'open' | 'in_progress' | 'closed';
  dueDate: string;
  createdAt: string;
}

export interface SystemNotification {
  id: string;
  category:
    | 'approval'
    | 'leave'
    | 'task'
    | 'maintenance'
    | 'calibration'
    | 'inventory'
    | 'warranty'
    | 'correspondence'
    | 'document';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  targetModule: ModuleKey;
  referenceId: string;
  dueDate: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: number;
  username: string;
  userRole: string;
  action: string;
  module: string;
  recordRef: string;
  description: string;
  ipAddress: string;
  createdAt: string;
}

export interface BackupEntry {
  id: string;
  filename: string;
  createdAt: string;
  sizeBytes: number;
  filesCount: number;
  sha256: string;
  triggerType: 'manual' | 'scheduled' | 'pre_restore';
  verified: boolean;
}

export interface SystemSettings {
  companyNameAr: string;
  companyNameEn: string;
  divisionNameAr: string;
  divisionNameEn: string;
  reportFooterAr: string;
  serverHost: string;
  serverPort: string;
  backupRetentionCount: number;
  autoBackupEnabled: boolean;
  calibrationAlertDays: number;
  warrantyAlertDays: number;
  documentCategories: string[];
  equipmentCategories: string[];
}

export interface DashboardSummary {
  kpis: {
    totalEmployees: number;
    activeEmployees: number;
    onLeaveEmployees: number;
    totalEquipment: number;
    equipmentUnderMaintenance: number;
    upcomingCalibrations: number;
    totalDocuments: number;
    pendingRequests: number;
    pendingLeaves: number;
    outstandingTasks: number;
    lowStockCount: number;
    overdueCorrespondence: number;
  };
  equipmentByStatus: Array<{ name: string; key: string; value: number }>;
  documentsByCategory: Array<{ name: string; count: number }>;
  recentDocuments: DocumentRecord[];
  upcomingDeadlines: Array<{
    id: string;
    title: string;
    module: ModuleKey;
    dueDate: string;
    severity: 'warning' | 'critical' | 'info';
    categoryLabel: string;
  }>;
  recentActivities: AuditLogEntry[];
}

export interface GlobalSearchResult {
  module: ModuleKey;
  moduleLabel: string;
  id: number;
  code: string;
  title: string;
  subtitle: string;
  status: string;
  date: string;
}

export const ROLE_LABELS: Record<UserRole, { ar: string; en: string }> = {
  manager: { ar: 'مدير الشعبة', en: 'Division Manager' },
  engineer: { ar: 'مهندس', en: 'Engineer' },
  viewer: { ar: 'مستعرض (قراءة فقط)', en: 'Viewer (Read-Only)' },
};
