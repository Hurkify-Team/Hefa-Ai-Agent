import {
  Activity,
  BarChart3,
  Bot,
  BrainCircuit,
  Building2,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  Cog,
  Database,
  FilePlus2,
  Grid3X3,
  Headphones,
  LayoutDashboard,
  ListChecks,
  MailCheck,
  MessageSquareText,
  Search,
  Settings,
  ShieldCheck,
  TableProperties,
  UserCog,
  UsersRound,
  Wrench,
} from "lucide-react";

export const sidebarSections = [
  {
    label: "Main Menu",
    items: [
      { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
      { label: "Data Capture", icon: ClipboardList, href: "/data-capture" },
      { label: "AI Assistance", icon: MessageSquareText, href: "/ai-chat" },
      { label: "Facility Notifications", icon: MailCheck, href: "/notifications" },
      { label: "Help Desk", icon: Headphones, href: "/help-desk" },
      { label: "Gmail Intelligence", icon: MailCheck, href: "/gmail-intelligence" },
      { label: "Facility Search", icon: Search, href: "/facility-search" },
      { label: "Facility Verification", icon: FileCheck2, href: "/facility-verification" },
      { label: "Portal Scan", icon: Grid3X3, href: "/portal-scan" },
      { label: "Reports & Analytics", icon: BarChart3, href: "/reports" },
      { label: "Audit Log", icon: ClipboardCheck, href: "/audit-log" },
      { label: "Duplicate Checker", icon: ShieldCheck, href: "/duplicate-checker" },
    ],
  },
  {
    label: "Manage Database",
    items: [
      { label: "Manage Categories", icon: TableProperties, href: "/categories" },
      { label: "Add New Facility", icon: FilePlus2, href: "/add-new-facility" },
      { label: "Data Cleaning", icon: Wrench, href: "/data-cleaning" },
      { label: "Bulk Operations", icon: Database, href: "/bulk-operations" },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Portal Settings", icon: Settings, href: "/portal-settings" },
      { label: "AI Settings", icon: BrainCircuit, href: "/ai-settings" },
      { label: "Users & Roles", icon: UsersRound, href: "/users-roles" },
      { label: "System Settings", icon: Cog, href: "/settings" },
    ],
  },
];

export const sheetHeaders = [
  "HEF/NO",
  "Facility Name",
  "Address",
  "LGA",
  "LCDA",
  "Facility E-Mail",
  "Owner's Name",
  "Owner's Address",
  "Contact",
  "Lab Sci",
];

export const facilityDetails = [
  ["Facility Name", "ABC Medical Laboratory"],
  ["Owner's Name", "Dr. John Adeyemi"],
  ["Address", "15 Emmanuel Street,\nIkeja, Lagos State"],
  ["Owner's Address", "15 Emmanuel Street,\nIkeja, Lagos State"],
  ["LGA", "Ikeja"],
  ["Lab Scientist", "2"],
  ["LCDA", "Ikeja LCDA"],
  ["Lab Tech", "3"],
  ["Contact", "08012345678"],
  ["Scope of Service", "Medical Laboratory Services"],
  ["Facility E-Mail", "abcmedlab@gmail.com"],
  ["Others", "-"],
];

export const previewRows = [
  { header: "HEF/NO", value: "HEF/LAB/23/00145", status: "success" },
  { header: "Facility Name", value: "ABC Medical Laboratory", status: "success" },
  {
    header: "Address",
    value: "15 Emmanuel Street, Ikeja, Lagos State",
    status: "success",
  },
  { header: "LGA", value: "Ikeja", status: "success" },
  { header: "LCDA", value: "Ikeja LCDA", status: "success" },
  { header: "Facility E-Mail", value: "abcmedlab@gmail.com", status: "success" },
  { header: "Owner's Name", value: "Dr. John Adeyemi", status: "success" },
  {
    header: "Owner's Address",
    value: "15 Emmanuel Street, Ikeja, Lagos State",
    status: "success",
  },
  { header: "Contact", value: "08012345678", status: "success" },
  { header: "Lab Sci", value: "2", status: "success" },
  { header: "Lab Tech", value: "3", status: "success" },
  {
    header: "Scope of Service",
    value: "Medical Laboratory Services",
    status: "success",
  },
  { header: "Others", value: "-", status: "neutral" },
  { header: "Date Registered", value: "-", status: "warning" },
  { header: "Date Insp.", value: "-", status: "warning" },
];

export const assistantActions = [
  { label: "Extract from Portal", icon: Grid3X3 },
  { label: "Search Facility", icon: Search },
  { label: "Check Duplicate", icon: ShieldCheck },
  { label: "Generate Report", icon: BarChart3 },
  { label: "Add New Category", icon: ListChecks },
];

export const analyticsRows = [
  {
    label: "Total Facilities",
    value: "2,456",
    icon: Building2,
    className: "bg-blue-50 text-blue-700",
  },
  {
    label: "Active Facilities",
    value: "1,890",
    icon: Activity,
    className: "bg-blue-50 text-blue-700",
  },
  {
    label: "Incomplete Records",
    value: "312",
    icon: Bot,
    className: "bg-amber-50 text-amber-700",
  },
  {
    label: "Total Categories",
    value: "16",
    icon: Database,
    className: "bg-violet-50 text-violet-700",
  },
];

export const recentActivities = [
  {
    title: "ABC Medical Laboratory",
    description: "Added to LABORATORY",
    time: "2 mins ago",
  },
  {
    title: "General Hospital Ikeja",
    description: "Updated in HOSPITAL",
    time: "15 mins ago",
  },
  {
    title: "New Category Added",
    description: "RADIOLOGY CENTRE",
    time: "1 hour ago",
  },
];
