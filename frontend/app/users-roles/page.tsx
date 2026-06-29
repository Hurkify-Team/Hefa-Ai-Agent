"use client";

import { safeJsonResponse } from "@/lib/safeJson";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  UsersRound,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { rolePermissions, teamRoles } from "@/lib/authAccess";
import type { AuthUser, TeamRole, TeamStatus } from "@/types/auth";

type UsersResponse = { users: AuthUser[] };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = await safeJsonResponse<Record<string, any>>(response, "app/users-roles/page.tsx");
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Request failed.");
  return payload.data as T;
}

export default function UsersRolesPage() {
  const [members, setMembers] = useState<AuthUser[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("Front Desk");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<TeamRole>("Front Desk");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function loadMembers() {
    setIsLoading(true);
    try {
      const data = await fetchJson<UsersResponse>("/api/auth/users");
      setMembers(data.users);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load workspace users.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadMembers();
  }, []);

  const filteredMembers = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) return members;
    return members.filter((member) =>
      [member.name, member.email, member.role, member.department].some((value) => value.toLowerCase().includes(cleanQuery)),
    );
  }, [members, query]);

  const activeCount = members.filter((member) => member.status === "active").length;

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanName || !cleanEmail || password.length < 8) {
      setMessage("Name, email, and a password of at least 8 characters are required.");
      return;
    }

    try {
      const data = await fetchJson<UsersResponse>("/api/auth/users", {
        body: JSON.stringify({ department, email: cleanEmail, name: cleanName, password, role }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      setMembers(data.users);
      setName("");
      setEmail("");
      setDepartment("Front Desk");
      setPassword("");
      setRole("Front Desk");
      setMessage("Workspace user added and can now sign in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add workspace user.");
    }
  }

  async function updateMember(id: string, patch: Partial<Pick<AuthUser, "department" | "name" | "role" | "status">>) {
    const previousMembers = members;
    setMembers((current) => current.map((member) => (member.id === id ? { ...member, ...patch } : member)));
    try {
      const data = await fetchJson<UsersResponse>("/api/auth/users", {
        body: JSON.stringify({ id, ...patch }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      setMembers(data.users);
    } catch (error) {
      setMembers(previousMembers);
      setMessage(error instanceof Error ? error.message : "Unable to update workspace user.");
    }
  }

  async function removeMember(id: string) {
    const previousMembers = members;
    setMembers((current) => current.filter((member) => member.id !== id));
    try {
      const data = await fetchJson<UsersResponse>("/api/auth/users", {
        body: JSON.stringify({ id }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      setMembers(data.users);
    } catch (error) {
      setMembers(previousMembers);
      setMessage(error instanceof Error ? error.message : "Unable to remove workspace user.");
    }
  }

  return (
    <AppShell>
      <section className="space-y-5 px-4 py-6 xl:px-6 2xl:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">Users & Roles</h1>
            <p className="mt-1 text-[14px] text-slate-600">
              Manage the HEFAMAA workspace team, department access, and role permissions.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-black uppercase tracking-[0.05em] text-slate-400">Members</p>
              <p className="mt-1 text-[22px] font-black text-slate-950">{members.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-black uppercase tracking-[0.05em] text-slate-400">Active</p>
              <p className="mt-1 text-[22px] font-black text-blue-700">{activeCount}</p>
            </div>
            <div className="hidden rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:block">
              <p className="text-[11px] font-black uppercase tracking-[0.05em] text-slate-400">Roles</p>
              <p className="mt-1 text-[22px] font-black text-slate-950">{teamRoles.length}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 2xl:grid-cols-[0.82fr_1.18fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Plus className="h-5 w-5 text-blue-600" />
              <h2 className="text-[17px] font-black text-slate-950">Add Workspace User</h2>
            </div>
            <form className="space-y-3" onSubmit={addMember}>
              <label className="block text-[12px] font-black text-slate-700">
                Full name
                <input className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setName(event.target.value)} placeholder="e.g. Registry Officer" value={name} />
              </label>
              <label className="block text-[12px] font-black text-slate-700">
                Email
                <input className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setEmail(event.target.value)} placeholder="officer@hefamaa.local" type="email" value={email} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[12px] font-black text-slate-700">
                  Department
                  <input className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setDepartment(event.target.value)} value={department} />
                </label>
                <label className="block text-[12px] font-black text-slate-700">
                  Role
                  <select className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setRole(event.target.value as TeamRole)} value={role}>
                    {teamRoles.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
              </div>
              <label className="block text-[12px] font-black text-slate-700">
                Temporary password
                <div className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-50">
                  <KeyRound className="h-4 w-4 text-slate-400" />
                  <input className="w-full bg-transparent text-[13px] font-semibold outline-none" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
                </div>
              </label>
              <button className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-[13px] font-black text-white hover:bg-blue-700" type="submit">
                <Plus className="h-4 w-4" />
                Add user
              </button>
              {message ? <p className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] font-bold text-blue-800">{message}</p> : null}
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <UsersRound className="h-5 w-5 text-blue-600" />
                <h2 className="text-[17px] font-black text-slate-950">HEFAMAA Workspace</h2>
              </div>
              <div className="flex h-10 min-w-[260px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-slate-500">
                <Search className="h-4 w-4" />
                <input className="w-full bg-transparent text-[13px] font-semibold outline-none placeholder:text-slate-400" onChange={(event) => setQuery(event.target.value)} placeholder="Search users or roles" value={query} />
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="grid gap-3 bg-slate-50 p-3 text-[11px] font-black uppercase tracking-[0.05em] text-slate-400 xl:grid-cols-[1.2fr_150px_160px_120px_120px]">
                <span>User</span><span>Role</span><span>Department</span><span>Status</span><span>Action</span>
              </div>
              {isLoading ? <p className="p-4 text-[13px] font-bold text-slate-500">Loading workspace users...</p> : null}
              {filteredMembers.map((member) => (
                <div className="grid gap-3 border-t border-slate-200 p-3 xl:grid-cols-[1.2fr_150px_160px_120px_120px]" key={member.id}>
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-100"><UserCog className="h-5 w-5" /></span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-black text-slate-950">{member.name}</p>
                      <p className="mt-1 flex items-center gap-1 truncate text-[11px] font-semibold text-slate-500"><Mail className="h-3.5 w-3.5" />{member.email}</p>
                    </div>
                  </div>
                  <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-black text-slate-700" onChange={(event) => void updateMember(member.id, { role: event.target.value as TeamRole })} value={member.role}>
                    {teamRoles.map((item) => <option key={item}>{item}</option>)}
                  </select>
                  <input className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-black text-slate-700" onBlur={(event) => void updateMember(member.id, { department: event.target.value })} defaultValue={member.department} />
                  <button className={["h-10 rounded-xl px-3 text-[12px] font-black", member.status === "active" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"].join(" ")} onClick={() => void updateMember(member.id, { status: (member.status === "active" ? "paused" : "active") as TeamStatus })} type="button">
                    {member.status === "active" ? "Active" : "Paused"}
                  </button>
                  <button className="flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3 text-[12px] font-black text-rose-700 disabled:opacity-40" disabled={member.role === "Super User"} onClick={() => void removeMember(member.id)} type="button">
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="grid gap-4 xl:grid-cols-7">
          {teamRoles.map((item) => (
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" key={item}>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-blue-600" />
                <h3 className="text-[13px] font-black text-slate-950">{item}</h3>
              </div>
              <div className="mt-3 space-y-2">
                {rolePermissions[item].map((permission) => (
                  <p className="flex items-start gap-2 text-[11px] font-semibold leading-5 text-slate-600" key={permission}>
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
                    {permission}
                  </p>
                ))}
              </div>
            </article>
          ))}
        </section>
      </section>
    </AppShell>
  );
}
