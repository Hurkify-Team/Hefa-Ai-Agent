export type NotificationTemplateId =
  | "pending_requirements_email"
  | "pending_requirements_sms"
  | "expired_accreditation_email"
  | "expired_accreditation_sms"
  | "missing_documents_email"
  | "missing_documents_sms"
  | "inspection_reminder_email"
  | "inspection_reminder_sms"
  | "provisional_license_ready_email"
  | "provisional_license_ready_sms"
  | "general_notice_email"
  | "general_notice_sms";

export type NotificationTemplate = {
  channel: "email" | "sms";
  created_at: string;
  id: NotificationTemplateId;
  is_default: boolean;
  message_body: string;
  subject: string;
  template_name: string;
  variables: string[];
};

export type TemplateVariables = Record<string, string | number | null | undefined>;

const agencyName = "HEFAMAA";
const portalLink = process.env.HEFAMAA_PORTAL_URL || "https://portal.hefamaaportal.com.ng/";

export const DEFAULT_NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
  {
    id: "pending_requirements_email",
    template_name: "Pending Requirements Email",
    channel: "email",
    subject: "HEFAMAA Notice: Action required for {{facilityName}}",
    message_body: "Dear {{ownerName}},\n\nThe Health Facility Monitoring and Accreditation Agency (HEFAMAA) has reviewed the portal record for {{facilityName}} and identified requirements that need your attention.\n\nFacility: {{facilityName}}\nCategory: {{category}}\nLGA: {{lga}}\nCurrent issue/status: {{missingRequirements}}\n\nRequired action:\nPlease sign in to the E-HEFAMAA portal, review the query or pending requirement, and upload or update the requested information before {{deadline}}.\n\nPortal: {{portalLink}}\n\nThis notice is issued to support timely processing of your facility registration or renewal. If you have already completed this action, kindly disregard this reminder.\n\nRegards,\nHealth Facility Monitoring and Accreditation Agency (HEFAMAA)",
    variables: ["facilityName","ownerName","category","lga","missingRequirements","deadline","portalLink","agencyName"],
    is_default: true,
    created_at: "2026-06-11T00:00:00.000Z",
  },
  {
    id: "pending_requirements_sms",
    template_name: "Pending Requirements SMS",
    channel: "sms",
    subject: "",
    message_body: "{{agencyName}}: {{facilityName}} has pending portal requirements. Action: {{missingRequirements}}. Login: {{portalLink}}. Deadline: {{deadline}}.",
    variables: ["agencyName","facilityName","missingRequirements","portalLink","deadline"],
    is_default: true,
    created_at: "2026-06-11T00:00:00.000Z",
  },
  {
    id: "expired_accreditation_email",
    template_name: "Accreditation Follow-up Email",
    channel: "email",
    subject: "HEFAMAA Accreditation Follow-up: {{facilityName}}",
    message_body: "Dear {{ownerName}},\n\nHEFAMAA records indicate that {{facilityName}} requires accreditation or renewal follow-up.\n\nFacility: {{facilityName}}\nCategory: {{category}}\nLGA: {{lga}}\nCurrent status: {{missingRequirements}}\n\nPlease review your E-HEFAMAA portal record and complete any outstanding accreditation or renewal action. Prompt action helps prevent service disruption and supports regulatory compliance.\n\nPortal: {{portalLink}}\n\nRegards,\nHealth Facility Monitoring and Accreditation Agency (HEFAMAA)",
    variables: ["ownerName","facilityName","category","lga","missingRequirements","portalLink","agencyName"],
    is_default: true,
    created_at: "2026-06-11T00:00:00.000Z",
  },
  {
    id: "expired_accreditation_sms",
    template_name: "Accreditation Follow-up SMS",
    channel: "sms",
    subject: "",
    message_body: "{{agencyName}}: {{facilityName}} requires accreditation/renewal follow-up. Status: {{missingRequirements}}. Login: {{portalLink}}.",
    variables: ["agencyName","facilityName","missingRequirements","portalLink"],
    is_default: true,
    created_at: "2026-06-11T00:00:00.000Z",
  },
  {
    id: "missing_documents_email",
    template_name: "Document Query Email",
    channel: "email",
    subject: "HEFAMAA Document Query: {{facilityName}}",
    message_body: "Dear {{ownerName}},\n\nA document query or missing requirement has been identified on the HEFAMAA portal record for {{facilityName}}.\n\nFacility: {{facilityName}}\nCategory: {{category}}\nLGA: {{lga}}\nQuery/required action: {{missingRequirements}}\n\nPlease log in to the E-HEFAMAA portal and upload the correct document or update the requested information. The application can only progress after the queried item has been resolved.\n\nPortal: {{portalLink}}\n\nRegards,\nHealth Facility Monitoring and Accreditation Agency (HEFAMAA)",
    variables: ["ownerName","facilityName","category","lga","missingRequirements","portalLink","agencyName"],
    is_default: true,
    created_at: "2026-06-11T00:00:00.000Z",
  },
  {
    id: "missing_documents_sms",
    template_name: "Document Query SMS",
    channel: "sms",
    subject: "",
    message_body: "{{agencyName}}: {{facilityName}} has a document query/missing requirement: {{missingRequirements}}. Please update your portal: {{portalLink}}.",
    variables: ["agencyName","facilityName","missingRequirements","portalLink"],
    is_default: true,
    created_at: "2026-06-11T00:00:00.000Z",
  },
  {
    id: "inspection_reminder_email",
    template_name: "Inspection Stage Email",
    channel: "email",
    subject: "HEFAMAA Inspection Stage Update: {{facilityName}}",
    message_body: "Dear {{ownerName}},\n\nThis is an official HEFAMAA update regarding the inspection stage for {{facilityName}}.\n\nFacility: {{facilityName}}\nCategory: {{category}}\nLGA: {{lga}}\nCurrent inspection/application status: {{missingRequirements}}\n\nPlease continue to monitor your E-HEFAMAA portal and respond promptly to any request from the inspection or approval team.\n\nPortal: {{portalLink}}\n\nRegards,\nHealth Facility Monitoring and Accreditation Agency (HEFAMAA)",
    variables: ["ownerName","facilityName","category","lga","missingRequirements","portalLink","agencyName"],
    is_default: true,
    created_at: "2026-06-11T00:00:00.000Z",
  },
  {
    id: "inspection_reminder_sms",
    template_name: "Inspection Stage SMS",
    channel: "sms",
    subject: "",
    message_body: "{{agencyName}}: {{facilityName}} inspection/application update - {{missingRequirements}}. Please monitor your portal: {{portalLink}}.",
    variables: ["agencyName","facilityName","missingRequirements","portalLink"],
    is_default: true,
    created_at: "2026-06-11T00:00:00.000Z",
  },
  {
    id: "provisional_license_ready_email",
    template_name: "Provisional License Ready Email",
    channel: "email",
    subject: "HEFAMAA Provisional License Ready: {{facilityName}}",
    message_body: "Dear {{ownerName}},\n\nHEFAMAA is pleased to notify you that the provisional license for {{facilityName}} is ready for download on the E-HEFAMAA portal.\n\nFacility: {{facilityName}}\nCategory: {{category}}\nLGA: {{lga}}\nCurrent portal status: {{missingRequirements}}\n\nPlease sign in to your portal account to download the provisional license and keep a copy for your facility records.\n\nPortal: {{portalLink}}\n\nRegards,\nHealth Facility Monitoring and Accreditation Agency (HEFAMAA)",
    variables: ["ownerName","facilityName","category","lga","missingRequirements","portalLink","agencyName"],
    is_default: true,
    created_at: "2026-06-11T00:00:00.000Z",
  },
  {
    id: "provisional_license_ready_sms",
    template_name: "Provisional License Ready SMS",
    channel: "sms",
    subject: "",
    message_body: "{{agencyName}}: The provisional license for {{facilityName}} is ready for download. Login to your portal: {{portalLink}}.",
    variables: ["agencyName","facilityName","portalLink"],
    is_default: true,
    created_at: "2026-06-11T00:00:00.000Z",
  },
  {
    id: "general_notice_email",
    template_name: "General HEFAMAA Notice Email",
    channel: "email",
    subject: "HEFAMAA Notice: {{facilityName}}",
    message_body: "Dear {{ownerName}},\n\nThis is an official HEFAMAA notification regarding {{facilityName}}.\n\nFacility: {{facilityName}}\nCategory: {{category}}\nLGA: {{lga}}\nNotice: {{missingRequirements}}\n\nPlease log in to the E-HEFAMAA portal for the latest update or required action.\n\nPortal: {{portalLink}}\n\nRegards,\nHealth Facility Monitoring and Accreditation Agency (HEFAMAA)",
    variables: ["ownerName","facilityName","category","lga","missingRequirements","portalLink","agencyName"],
    is_default: true,
    created_at: "2026-06-11T00:00:00.000Z",
  },
  {
    id: "general_notice_sms",
    template_name: "General HEFAMAA Notice SMS",
    channel: "sms",
    subject: "",
    message_body: "{{agencyName}} notice for {{facilityName}}: {{missingRequirements}}. Portal: {{portalLink}}.",
    variables: ["agencyName","facilityName","missingRequirements","portalLink"],
    is_default: true,
    created_at: "2026-06-11T00:00:00.000Z",
  }
];

function fallbackVariables(values: TemplateVariables): Record<string, string> {
  return {
    agencyName,
    category: String(values.category ?? ""),
    deadline: String(values.deadline ?? "7 days"),
    facilityName: String(values.facilityName ?? "your facility"),
    lga: String(values.lga ?? ""),
    missingRequirements: String(values.missingRequirements ?? "Please review your portal status and complete all pending requirements."),
    ownerName: String(values.ownerName ?? "Facility Owner"),
    portalLink: String(values.portalLink ?? portalLink),
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value ?? "")])),
  };
}

export function templateFor(channel: "email" | "sms", preferred?: string) {
  return DEFAULT_NOTIFICATION_TEMPLATES.find((template) => template.id === preferred && template.channel === channel)
    ?? DEFAULT_NOTIFICATION_TEMPLATES.find((template) => template.id === (channel === "email" ? "general_notice_email" : "general_notice_sms"))!;
}

export function renderTemplate(template: NotificationTemplate, values: TemplateVariables) {
  const variables = fallbackVariables(values);
  const replace = (content: string) => content.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => variables[key] ?? "");
  return {
    message: replace(template.message_body),
    subject: replace(template.subject || "HEFAMAA notification"),
  };
}
