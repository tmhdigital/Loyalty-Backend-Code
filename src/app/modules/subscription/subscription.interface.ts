import { Model, Types } from 'mongoose';

export type ISubscription = {
    customerId: string;
    price: number;
    user: Types.ObjectId;
    package: Types.ObjectId;
    trxId: string;
    remaining: number;
    subscriptionId: string;
    status: 'expired' | 'active' | 'cancel';
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    source: 'online' | 'salesRep' | 'kuickpay' | 'free' | 'manual';
    
};

export type SubscriptionModel = Model<ISubscription, Record<string, unknown>>;