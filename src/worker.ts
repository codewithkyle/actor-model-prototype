/// <reference path="./worker.d.ts" />
/// <reference path="./messages.d.ts" />

class BroadcastHelper
{
    private queuedMessages : Array<BroadcastWorkerMessage>;
    private queueTimer : any;
    private queueTimeout: number = 1000; // Milliseconds
    private inboxes : Array<InboxData>;

    constructor()
    {
        self.onmessage = this.handleMessage.bind(this);
        this.queuedMessages = [];
        this.queueTimer = null;
        this.inboxes = [];

        // @ts-ignore
        self.postMessage({
            type: 'ready',
        });
    }

    /**
     * Add the inbox to the inboxes array.
     * @param data - an `InboxHookupMessage` object
     */
    private async addInbox(data:InboxHookupMessage)
    {
        const { name, inboxAddress } = data;
        const inboxData:InboxData = {
            name: name.trim().toLowerCase(),
            address: inboxAddress,
            uid: this.generateUUID(),
        }
        this.inboxes.push(inboxData);
    }

    /**
     * The personal inbox of the `broadcast-worker` inbox.
     * @param data - the incoming `BroadcastWorkerMessage` data object
     */
    private inbox(data:MessageData)
    {
        switch (data.type)
        {
            case 'hookup':
                this.addInbox(data as InboxHookupMessage);
                break;
            default:
                console.warn(`Unknown message type: ${ data.type }`);
        }
    }

    /**
     * Look up the recipient(s) within the IDBDatabase.
     * If inbox addresses are found send the array of inbox indexes to the broadcasters inbox.
     * If no recipient(s) are found check the message protocol.
     * If `UDP` the message is dropped.
     * If `TCP` the message is queued and will be reattempted at a late time.
     * @param message - the `BroadcastWorkerMessage` object
     */
    private async lookup(message:BroadcastWorkerMessage)
    {
        const { data, protocol } = message;
        const recipient = message.recipient.trim().toLowerCase();
        try
        {
            const inboxAddressIndexes:Array<number> = [];
            for (let i = 0; i < this.inboxes.length; i++)
            {
                const inbox = this.inboxes[i];
                if (inbox.name === recipient)
                {
                    inboxAddressIndexes.push(inbox.address);
                }
            }

            if (inboxAddressIndexes.length)
            {
                // @ts-ignore
                self.postMessage({
                    type: 'lookup',
                    data: data,
                    inboxIndexes: inboxAddressIndexes,
                });
            }
            else if (protocol === 'TCP' && message.messageId !== null)
            {
                if (message?.attempts < message.maxAttempts)
                {
                    message.attempts += 1;
                }
                else if (message?.attempts === message.maxAttempts)
                {
                    this.dropMessageFromQueue(message.messageId);
                }
                else
                {
                    message.attempts = 1;
                    this.queuedMessages.push(message);
                    if (this.queueTimer === null)
                    {
                        this.queueTimer = setTimeout(this.flushMessageQueue.bind(this), this.queueTimeout);
                    }
                }
            }
        }
        catch (error)
        {
            console.error(error);
        }
    }

    /**
     * Attempts to `lookup()` any `TCP` messages that previously failed.
     */
    private flushMessageQueue() : void
    {
        for (let i = 0; i < this.queuedMessages.length; i++)
        {
            this.lookup(this.queuedMessages[i]);
        }
        
        if (this.queuedMessages.length)
        {
            this.queueTimer = setTimeout(this.flushMessageQueue.bind(this), this.queueTimeout);
        }
        else
        {
            this.queueTimer = null;
        }
    }

    /**
     * Drops a queued message when the message has reached it's maximum number of attempts.
     * @param messageId - the `uid` of the message that needs to be dropped.
     */
    private dropMessageFromQueue(messageId:string) : void
    {
        for (let i = 0; i < this.queuedMessages.length; i++)
        {
            if (this.queuedMessages[i].messageId === messageId)
            {
                this.queuedMessages.splice(i, 1);
                break;
            }
        }
    }

    /**
     * Worker received a message from another thread.
     * This method is an alias of `self.onmessage`
     * */
    private handleMessage(e:MessageEvent)
    {
        const { recipient, data } = e.data;
        switch (recipient)
        {
            case 'broadcast-worker':
                this.inbox(data);
                break;
            default:
                this.lookup(e.data);
                break;
        }
    }

    /**
     * Quick and dirty unique ID generation.
     * This method does not follow RFC 4122 and does not guarantee a universally unique ID.
     * @see https://tools.ietf.org/html/rfc4122
     */
    private generateUUID() : string
    {
        return new Array(4)
            .fill(0)
            .map(() => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16))
            .join("-");
    }
}

new BroadcastHelper();
