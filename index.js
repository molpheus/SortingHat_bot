const { Client, GatewayIntentBits, Events, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { parse } = require('csv-parse/sync');
const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Storage for server-specific data
// Structure: { guildId: { csvData: Map(value -> role), channelId: string, adminChannelId: string, keyColumn: string, valueColumn: string } }
const serverData = new Map();

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Handle messages
client.on(Events.MessageCreate, async message => {
    // Ignore bot messages
    if (message.author.bot) return;

    const guildId = message.guild?.id;
    if (!guildId) return;

    const guildData = serverData.get(guildId);

    // Check if message is in the designated channel
    if (guildData && guildData.channelId === message.channel.id) {
        // Try to match the message content to a value in the CSV data
        const content = message.content.trim();
        
        if (guildData.csvData && guildData.csvData.has(content)) {
            const roleKey = guildData.csvData.get(content);
            
            // Find the role by name
            const role = message.guild.roles.cache.find(r => r.name === roleKey);
            
            if (role) {
                try {
                    await message.member.roles.add(role);
                    // Send ephemeral-like message and delete after 5 seconds
                    const reply = await message.reply(`ロール「${role.name}」を付与しました！`);
                    setTimeout(() => {
                        reply.delete().catch(console.error);
                    }, 5000);
                } catch (error) {
                    console.error('Error adding role:', error);
                    const errorReply = await message.reply('ロールの付与に失敗しました。');
                    setTimeout(() => {
                        errorReply.delete().catch(console.error);
                    }, 5000);
                }
            } else {
                const reply = await message.reply(`ロール「${roleKey}」が見つかりません。`);
                setTimeout(() => {
                    reply.delete().catch(console.error);
                }, 5000);
            }
        }
        
        // Delete the user's message after processing
        try {
            await message.delete();
        } catch (error) {
            console.error('Error deleting message:', error);
        }
    }

    // Handle commands (only for administrators)
    if (message.content.startsWith('!')) {
        // Check if user has administrator permissions
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return;
        }

        const args = message.content.slice(1).trim().split(/\s+/);
        const command = args.shift().toLowerCase();
        
        // Check if admin channel is set and if current channel is the admin channel
        const currentGuildData = serverData.get(guildId);
        if (currentGuildData?.adminChannelId && currentGuildData.adminChannelId !== message.channel.id) {
            // Silently ignore commands in non-admin channels
            const warningMsg = await message.reply('⚠️ 管理コマンドは管理チャンネルでのみ実行できます。');
            setTimeout(() => {
                warningMsg.delete().catch(console.error);
                message.delete().catch(console.error);
            }, 5000);
            return;
        }

        if (command === 'setadminchannel') {
            // Set the channel for admin commands
            const channelId = message.channel.id;
            
            if (!serverData.has(guildId)) {
                serverData.set(guildId, { csvData: null, channelId: null, adminChannelId: null, keyColumn: null, valueColumn: null });
            }
            
            serverData.get(guildId).adminChannelId = channelId;
            await message.reply(`✅ このチャンネルを管理コマンド専用チャンネルに設定しました。\n今後、管理コマンドはこのチャンネルでのみ実行できます。`);
        } else if (command === 'setchannel') {
            // Set the channel for role assignment
            let targetChannelId;
            
            if (args.length > 0) {
                // Channel ID or mention was provided
                const channelArg = args[0];
                // Extract channel ID from mention or use as-is
                const channelIdMatch = channelArg.match(/^(?:<#)?(\d+)>?$/);
                
                if (!channelIdMatch) {
                    await message.reply('❌ 無効なチャンネルIDまたはメンションです。\n使い方: `!setchannel` または `!setchannel #チャンネル` または `!setchannel チャンネルID`');
                    return;
                }
                
                targetChannelId = channelIdMatch[1];
                
                // Verify that the channel exists in this guild
                const targetChannel = message.guild.channels.cache.get(targetChannelId);
                if (!targetChannel) {
                    await message.reply('❌ 指定されたチャンネルが見つかりません。');
                    return;
                }
            } else {
                // No argument provided, use current channel
                targetChannelId = message.channel.id;
            }
            
            if (!serverData.has(guildId)) {
                serverData.set(guildId, { csvData: null, channelId: null, adminChannelId: null, keyColumn: null, valueColumn: null });
            }
            
            serverData.get(guildId).channelId = targetChannelId;
            await message.reply(`✅ <#${targetChannelId}> をロール付与チャンネルに設定しました。`);
        } else if (command === 'uploadcsv') {
            // Check if there's an attachment
            if (message.attachments.size === 0) {
                await message.reply('CSVファイルを添付してください。使い方: `!uploadcsv <KeyColumnId> <ValueColumnId>`\n例: `!uploadcsv 0 1` (0列目がKey、1列目がValue)');
                return;
            }

            if (args.length < 2) {
                await message.reply('KeyとValueの列IDを指定してください。使い方: `!uploadcsv <KeyColumnId> <ValueColumnId>`\n例: `!uploadcsv 0 1`');
                return;
            }

            const keyColumnId = parseInt(args[0]);
            const valueColumnId = parseInt(args[1]);

            if (isNaN(keyColumnId) || isNaN(valueColumnId)) {
                await message.reply('列IDは数字で指定してください。');
                return;
            }

            if (keyColumnId < 0 || valueColumnId < 0) {
                await message.reply('列IDは0以上の値を指定してください。');
                return;
            }

            const attachment = message.attachments.first();
            
            // Check if it's a CSV file
            if (!attachment.name.endsWith('.csv')) {
                await message.reply('CSVファイルのみアップロード可能です。');
                return;
            }

            try {
                // Download the CSV file
                const response = await fetch(attachment.url);
                const csvContent = await response.text();

                // Parse CSV
                const records = parse(csvContent, {
                    skip_empty_lines: true,
                    trim: true
                });

                // Create mapping: Value -> Key (Role)
                const csvData = new Map();
                let successCount = 0;
                const errors = [];
                const successRecords = [];

                for (let i = 0; i < records.length; i++) {
                    const record = records[i];
                    const rowNum = i + 1;
                    
                    if (keyColumnId >= record.length || valueColumnId >= record.length) {
                        errors.push(`行${rowNum}: 列インデックスが範囲外 (要求: Key=${keyColumnId}, Value=${valueColumnId}, 実際の列数=${record.length})`);
                        continue;
                    }

                    const key = record[keyColumnId]?.trim();
                    const value = record[valueColumnId]?.trim();

                    if (key && value) {
                        csvData.set(value, key);
                        successRecords.push(`行${rowNum}: "${value}" → ロール "${key}"`);
                        successCount++;
                    } else {
                        if (!key && !value) {
                            errors.push(`行${rowNum}: KeyとValueが両方とも空`);
                        } else if (!key) {
                            errors.push(`行${rowNum}: Key(列${keyColumnId})が空 (Value: "${value}")`);
                        } else {
                            errors.push(`行${rowNum}: Value(列${valueColumnId})が空 (Key: "${key}")`);
                        }
                    }
                }

                // Store the data for this guild
                if (!serverData.has(guildId)) {
                    serverData.set(guildId, { csvData: null, channelId: null, adminChannelId: null, keyColumn: null, valueColumn: null });
                }

                const guildDataObj = serverData.get(guildId);
                guildDataObj.csvData = csvData;
                guildDataObj.keyColumn = keyColumnId;
                guildDataObj.valueColumn = valueColumnId;

                // Create detailed report
                let reportMsg = `✅ CSVファイルを読み込みました。\n`;
                reportMsg += `成功: ${successCount}件、エラー: ${errors.length}件\n`;
                reportMsg += `Key列: ${keyColumnId}、Value列: ${valueColumnId}\n\n`;

                // Show first 10 successful records
                if (successRecords.length > 0) {
                    reportMsg += `**成功したレコード (最初の${Math.min(10, successRecords.length)}件):**\n`;
                    reportMsg += successRecords.slice(0, 10).join('\n');
                    if (successRecords.length > 10) {
                        reportMsg += `\n... 他 ${successRecords.length - 10}件`;
                    }
                    reportMsg += '\n\n';
                }

                // Show all errors
                if (errors.length > 0) {
                    reportMsg += `**エラー (${errors.length}件):**\n`;
                    reportMsg += errors.slice(0, 10).join('\n');
                    if (errors.length > 10) {
                        reportMsg += `\n... 他 ${errors.length - 10}件`;
                    }
                }

                // Discord has a 2000 character limit for messages
                if (reportMsg.length > 1900) {
                    const summaryMsg = `✅ CSVファイルを読み込みました。\n`;
                    const summaryContent = `成功: ${successCount}件、エラー: ${errors.length}件\n`;
                    const summaryDetails = `Key列: ${keyColumnId}、Value列: ${valueColumnId}\n\n`;
                    const errorSection = errors.length > 0 ? `**エラー (${errors.length}件):**\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n... 他 ${errors.length - 5}件` : ''}` : '';
                    
                    await message.reply(summaryMsg + summaryContent + summaryDetails + errorSection + '\n\n⚠️ 詳細が長すぎるため省略されました。');
                } else {
                    await message.reply(reportMsg);
                }
            } catch (error) {
                console.error('Error processing CSV:', error);
                await message.reply('CSVファイルの処理中にエラーが発生しました。');
            }
        } else if (command === 'status') {
            // Show current configuration
            const guildDataObj = serverData.get(guildId);
            
            if (!guildDataObj) {
                await message.reply('このサーバーではまだ設定が行われていません。');
                return;
            }

            let statusMsg = '**現在の設定:**\n';
            statusMsg += `管理チャンネル: ${guildDataObj.adminChannelId ? `<#${guildDataObj.adminChannelId}>` : '未設定'}\n`;
            statusMsg += `ロール付与チャンネル: ${guildDataObj.channelId ? `<#${guildDataObj.channelId}>` : '未設定'}\n`;
            statusMsg += `CSVデータ: ${guildDataObj.csvData ? `${guildDataObj.csvData.size}件` : '未設定'}\n`;
            
            if (guildDataObj.keyColumn !== null && guildDataObj.valueColumn !== null) {
                statusMsg += `Key列: ${guildDataObj.keyColumn}、Value列: ${guildDataObj.valueColumn}\n`;
            }

            await message.reply(statusMsg);
        } else if (command === 'addentry') {
            // Add a single entry to the CSV data
            if (args.length < 2) {
                await message.reply('❌ ValueとRoleを指定してください。\n使い方: `!addentry <Value> <Role>`\n例: `!addentry student 学生`');
                return;
            }

            const value = args[0];
            const role = args.slice(1).join(' ');

            if (!serverData.has(guildId) || !serverData.get(guildId).csvData) {
                await message.reply('❌ CSVデータが設定されていません。先に `!uploadcsv` でデータをアップロードしてください。');
                return;
            }

            const guildDataObj = serverData.get(guildId);
            const existed = guildDataObj.csvData.has(value);
            guildDataObj.csvData.set(value, role);

            if (existed) {
                await message.reply(`✅ エントリを更新しました: "${value}" → ロール "${role}"`);
            } else {
                await message.reply(`✅ エントリを追加しました: "${value}" → ロール "${role}"\n現在 ${guildDataObj.csvData.size}件のエントリが登録されています。`);
            }
        } else if (command === 'removeentry') {
            // Remove a single entry from the CSV data
            if (args.length < 1) {
                await message.reply('❌ 削除するValueを指定してください。\n使い方: `!removeentry <Value>`\n例: `!removeentry student`');
                return;
            }

            const value = args[0];

            if (!serverData.has(guildId) || !serverData.get(guildId).csvData) {
                await message.reply('❌ CSVデータが設定されていません。');
                return;
            }

            const guildDataObj = serverData.get(guildId);
            const role = guildDataObj.csvData.get(value);

            if (guildDataObj.csvData.delete(value)) {
                await message.reply(`✅ エントリを削除しました: "${value}" (ロール: "${role}")\n残り ${guildDataObj.csvData.size}件のエントリが登録されています。`);
            } else {
                await message.reply(`❌ エントリ "${value}" が見つかりませんでした。`);
            }
        } else if (command === 'listentries') {
            // List all entries in the CSV data
            if (!serverData.has(guildId) || !serverData.get(guildId).csvData) {
                await message.reply('❌ CSVデータが設定されていません。');
                return;
            }

            const guildDataObj = serverData.get(guildId);
            const entries = Array.from(guildDataObj.csvData.entries());

            if (entries.length === 0) {
                await message.reply('📋 登録されているエントリはありません。');
                return;
            }

            let listMsg = `**登録されているエントリ (${entries.length}件):**\n\n`;
            
            // Show first 20 entries
            const displayEntries = entries.slice(0, 20);
            displayEntries.forEach(([value, role], index) => {
                listMsg += `${index + 1}. "${value}" → ロール "${role}"\n`;
            });

            if (entries.length > 20) {
                listMsg += `\n... 他 ${entries.length - 20}件`;
            }

            // Discord has a 2000 character limit
            if (listMsg.length > 1900) {
                listMsg = `**登録されているエントリ (${entries.length}件):**\n\n`;
                const displayEntries = entries.slice(0, 10);
                displayEntries.forEach(([value, role], index) => {
                    listMsg += `${index + 1}. "${value}" → "${role}"\n`;
                });
                listMsg += `\n... 他 ${entries.length - 10}件\n\n⚠️ 詳細が長すぎるため省略されました。`;
            }

            await message.reply(listMsg);
        } else if (command === 'clearcsv') {
            // Clear all CSV data
            if (!serverData.has(guildId) || !serverData.get(guildId).csvData) {
                await message.reply('❌ CSVデータが設定されていません。');
                return;
            }

            const guildDataObj = serverData.get(guildId);
            const entryCount = guildDataObj.csvData.size;
            guildDataObj.csvData = new Map();

            await message.reply(`✅ CSVデータをクリアしました。(削除: ${entryCount}件)`);
        } else if (command === 'help') {
            const helpMsg = `
**SortingHat Bot コマンド一覧** (管理者のみ)

**初期設定:**
\`!setadminchannel\` - 現在のチャンネルを管理コマンド専用チャンネルに設定
\`!setchannel [#チャンネル|チャンネルID]\` - ロール付与チャンネルを設定
  例: \`!setchannel\` / \`!setchannel #role-assignment\` / \`!setchannel 123...\`

**CSV管理:**
\`!uploadcsv <KeyColumnId> <ValueColumnId>\` - CSVファイルをアップロード
  例: \`!uploadcsv 0 1\` (0列目=ロール名、1列目=入力値)
\`!listentries\` - 登録されているエントリの一覧を表示
\`!addentry <Value> <Role>\` - エントリを追加/更新
  例: \`!addentry student 学生\`
\`!removeentry <Value>\` - エントリを削除
  例: \`!removeentry student\`
\`!clearcsv\` - すべてのCSVデータをクリア

**情報表示:**
\`!status\` - 現在の設定を表示
\`!help\` - このヘルプメッセージを表示

**使い方:**
1. \`!setadminchannel\` で管理コマンド専用チャンネルを設定 (推奨)
2. \`!setchannel #チャンネル名\` でロール付与を行うチャンネルを設定
3. \`!uploadcsv 0 1\` でCSVファイルをアップロード
4. \`!listentries\` でエントリを確認
5. 必要に応じて \`!addentry\` / \`!removeentry\` で個別編集
6. ユーザーが指定チャンネルで値を投稿するとロール自動付与

**セキュリティ:**
- 管理チャンネル設定後、管理コマンドはそのチャンネルでのみ実行可能
- 管理チャンネルから他のチャンネルをID/メンションで指定可能
            `;
            await message.reply(helpMsg);
        }
    }
});

// Login to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);

// HTTP server for health checks and status monitoring
const PORT = process.env.BOT_PORT || 3000;

const server = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Health check endpoint
    if (req.url === '/health') {
        const isReady = client.isReady();
        const statusCode = isReady ? 200 : 503;
        
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: isReady ? 'ok' : 'not ready',
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        }));
        return;
    }

    // Status endpoint
    if (req.url === '/status') {
        const isReady = client.isReady();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            bot: {
                ready: isReady,
                user: isReady ? client.user.tag : null,
                guilds: isReady ? client.guilds.cache.size : 0
            },
            servers: {
                configured: serverData.size,
                details: Array.from(serverData.entries()).map(([guildId, data]) => ({
                    guildId,
                    hasCSV: data.csvData !== null,
                    csvEntries: data.csvData ? data.csvData.size : 0,
                    channelSet: data.channelId !== null
                }))
            },
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        }));
        return;
    }

    // Root endpoint
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            name: 'SortingHat Bot',
            version: '1.0.0',
            status: client.isReady() ? 'running' : 'starting',
            endpoints: {
                health: '/health',
                status: '/status'
            }
        }));
        return;
    }

    // 404 for other routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP server listening on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Status: http://localhost:${PORT}/status`);
});
