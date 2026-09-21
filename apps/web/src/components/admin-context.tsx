'use client';

import { createContext, useContext } from 'react';
import type { Me } from '@/lib/admin';

export const MeContext = createContext<Me | null>(null);

/** المدير الحالي بصلاحياته — تملؤه قشرة الإدارة */
export const useMe = (): Me => useContext(MeContext)!;

export const can = (me: Me, perm?: string): boolean => !perm || me.permissions.includes(perm);
