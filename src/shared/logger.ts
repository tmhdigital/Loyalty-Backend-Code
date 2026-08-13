import path from 'path';
import DailyRotateFile from 'winston-daily-rotate-file';
import { createLogger, format, transports } from 'winston';
import config from '../config';
const { combine, timestamp, label, printf } = format;

interface IMessageProps{
    level: string;
    message: string;
    label: string;
    timestamp: Date;
}


const myFormat = printf((info: any) => {
    const { level, message, label, timestamp } = info as IMessageProps & any;
    const date = new Date(timestamp);
    const hour = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    return `${date.toDateString()} ${hour}:${minutes}:${seconds} [${label}] ${level}: ${message}`;
});


const logger = createLogger({
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    format: combine(label({ label: 'PROJECT_NAME' }), timestamp(), myFormat),
    transports: [
        new transports.Console({ level: config.node_env === "production" ? "warn" : "info" }),
        new DailyRotateFile({
            filename: path.join(process.cwd(), 'winston','success','%DATE%-success.log'),
            datePattern: 'DD-MM-YYYY-HH',
            maxSize: '20m',
            maxFiles: '1d',
        })
    ]
});

const errorLogger = createLogger({
    level: 'error',
    format: combine(label({ label: 'PROJECT_NAME' }), timestamp(), myFormat),
    transports: [
        new transports.Console({ level: config.node_env === "production" ? "warn" : "info" }),
        new DailyRotateFile({
            filename: path.join(
            process.cwd(),'winston','error','%DATE%-error.log'),
            datePattern: 'DD-MM-YYYY-HH',
            maxSize: '20m',
            maxFiles: '1d'
        })
    ]
});

export { errorLogger, logger };