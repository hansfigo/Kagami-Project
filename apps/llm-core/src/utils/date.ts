export function getCurrentDateTimeInfo(): string {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
        weekday: 'long', // Senin, Selasa
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'shortOffset',
    };
    const formattedDate = now.toLocaleDateString('id-ID', options);
    const formattedTime = now.toLocaleTimeString('id-ID', options);

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezoneOffset = now.toLocaleString('en', { timeZoneName: 'shortOffset' }).match(/GMT[+-]\d{1,2}/)?.[0] || '';

    return `waktu saat ini adalah ${formattedDate} ${formattedTime} ${timezoneOffset} (${timezone}).`;
}