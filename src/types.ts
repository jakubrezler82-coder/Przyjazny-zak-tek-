export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  individualNumber: string;
  prepStatus?: boolean;
  lastHivTest?: string;
  lastSyphilisTest?: string;
  hivTestIntervalMonths?: number;
  syphilisTestIntervalMonths?: number;
  nextHivTestDate?: string;
  nextSyphilisTestDate?: string;
  role: 'admin' | 'user';
}

export interface JournalEntry {
  id?: string;
  userId: string;
  date: string;
  topic: string;
  content: string;
  moodScore?: number;
  isDepressive?: boolean;
  voiceNoteUrl?: string;
  videoNoteUrl?: string;
}

export interface DateLog {
  id?: string;
  userId: string;
  partnerName: string;
  contact?: string;
  moodBefore?: number;
  moodAfter?: number;
  sexOccurred?: boolean;
  likes?: string;
  dislikes?: string;
  redFlags?: string;
  wantToMeetAgain?: boolean;
  location?: string;
  audioNoteUrl?: string;
  timestamp: string;
}

export interface SexEncounter {
  id?: string;
  userId: string;
  partnerId?: string;
  partnerName?: string;
  timestamp: string;
  sexType: string[];
  sexTypeOther?: string;
  protection: string[];
  protectionOther?: string;
  chemsex?: boolean;
  moodScore: number;
  hasConcerns: boolean;
  concernLocation?: 'me' | 'partner' | 'both';
  symptoms?: string[];
  symptomsOther?: string;
  wantToMeetAgain: boolean;
  afterFeelings?: string;
}

export interface InfectionNotification {
  id?: string;
  fromUserId: string;
  toUserId: string;
  encounterDate: string;
  timestamp: string;
  read: boolean;
}

export interface AdminContent {
  id?: string;
  slug: string;
  title: string;
  body: string;
  lastUpdated: string;
}
