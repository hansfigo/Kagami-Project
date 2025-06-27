export class Logger {
    private static instance: Logger;
    private logs: string[] = [];

    private constructor() { }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    public log(message: string): void {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}`;
        this.logs.push(logEntry);
        console.log(logEntry);
    }

    public getLogs(): string[] {
        return this.logs;
    }

    public clearLogs(): void {
        this.logs = [];
    }
}