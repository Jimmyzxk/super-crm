export function isConvertPhoneValid(linked: boolean, submittedPhone: string, matchedPhone?: string | null): boolean {
  return linked || !matchedPhone || submittedPhone !== matchedPhone;
}
