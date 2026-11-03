/**
 * 회원가입 입력 규칙 (화면·Route Handler 공통).
 *
 * 백엔드 SignupRequest(ITDA 저장소 origin/dev 기준 확인)와 같은 규칙만 둔다.
 * - loginId: @NotBlank @Size(min = 4, max = 50)
 * - password: @NotBlank @Size(min = 8, max = 64)
 * - institutionId: @NotNull UUID
 * 문자 종류 제한·비밀번호 조합 규칙은 백엔드에 없어 두지 않는다. 입력값은 바꾸지(trim) 않고 그대로 보낸다.
 */

export const LOGIN_ID_LENGTH = { min: 4, max: 50 } as const;
export const PASSWORD_LENGTH = { min: 8, max: 64 } as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isInstitutionId = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);

export interface SignupFormValues {
  institutionId: string;
  loginId: string;
  password: string;
  /** 화면에서만 비교한다. 서버로 보내지 않는다 */
  passwordConfirm: string;
}

export type SignupField = keyof SignupFormValues;
export type SignupFieldErrors = Partial<Record<SignupField, string>>;

/** 화면에 오류를 보여 줄 순서 (첫 오류 칸으로 포커스를 옮길 때 쓴다) */
export const SIGNUP_FIELD_ORDER: readonly SignupField[] = ["institutionId", "loginId", "password", "passwordConfirm"];

const isBlank = (value: string) => value.trim() === "";

/** 서버로 보내는 세 값 검증 (Route Handler도 같은 규칙으로 다시 확인한다) */
export function validateSignupRequest({
  institutionId,
  loginId,
  password,
}: Omit<SignupFormValues, "passwordConfirm">): SignupFieldErrors {
  const errors: SignupFieldErrors = {};
  if (!institutionId) errors.institutionId = "소속 기관을 선택하세요.";
  else if (!isInstitutionId(institutionId)) errors.institutionId = "소속 기관을 다시 선택하세요.";

  if (loginId === "") errors.loginId = "아이디를 입력하세요.";
  else if (isBlank(loginId)) errors.loginId = "공백만으로는 아이디를 만들 수 없습니다.";
  else if (loginId.length < LOGIN_ID_LENGTH.min || loginId.length > LOGIN_ID_LENGTH.max) {
    errors.loginId = `아이디는 ${LOGIN_ID_LENGTH.min}~${LOGIN_ID_LENGTH.max}자로 입력하세요.`;
  }

  if (password === "") errors.password = "비밀번호를 입력하세요.";
  else if (isBlank(password)) errors.password = "공백만으로는 비밀번호를 만들 수 없습니다.";
  else if (password.length < PASSWORD_LENGTH.min || password.length > PASSWORD_LENGTH.max) {
    errors.password = `비밀번호는 ${PASSWORD_LENGTH.min}~${PASSWORD_LENGTH.max}자로 입력하세요.`;
  }
  return errors;
}

/** 화면 입력 전체 검증 (비밀번호 확인 포함) */
export function validateSignupForm(values: SignupFormValues): SignupFieldErrors {
  const errors = validateSignupRequest(values);
  if (values.passwordConfirm === "") errors.passwordConfirm = "비밀번호를 한 번 더 입력하세요.";
  else if (values.passwordConfirm !== values.password) errors.passwordConfirm = "비밀번호가 일치하지 않습니다.";
  return errors;
}
