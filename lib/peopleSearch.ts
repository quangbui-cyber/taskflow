export type SearchablePerson = {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string | null;
};

export function normalizePeopleSearch(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").trim();
}

export function matchesPerson(person: SearchablePerson, query: string): boolean {
  const text = normalizePeopleSearch(`${person.name} ${person.email ?? ""}`);
  return normalizePeopleSearch(query).split(/\s+/).every((word) => text.includes(word));
}
