const { Client, GatewayIntentBits, Events, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { parse } = require('csv-parse/sync');
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
// Structure: { guildId: { csvData: Map(value -> role), channelId: string, keyColumn: string, valueColumn: string } }
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

        if (command === 'setchannel') {
            // Set the channel for role assignment
            const channelId = message.channel.id;
            
            if (!serverData.has(guildId)) {
                serverData.set(guildId, { csvData: null, channelId: null, keyColumn: null, valueColumn: null });
            }
            
            serverData.get(guildId).channelId = channelId;
            await message.reply(`このチャンネルをロール付与チャンネルに設定しました。`);
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
                let errorCount = 0;

                for (let i = 0; i < records.length; i++) {
                    const record = records[i];
                    
                    if (keyColumnId >= record.length || valueColumnId >= record.length) {
                        console.error(`Row ${i}: Column index out of bounds`);
                        errorCount++;
                        continue;
                    }

                    const key = record[keyColumnId]?.trim();
                    const value = record[valueColumnId]?.trim();

                    if (key && value) {
                        csvData.set(value, key);
                        successCount++;
                    } else {
                        errorCount++;
                    }
                }

                // Store the data for this guild
                if (!serverData.has(guildId)) {
                    serverData.set(guildId, { csvData: null, channelId: null, keyColumn: null, valueColumn: null });
                }

                const guildDataObj = serverData.get(guildId);
                guildDataObj.csvData = csvData;
                guildDataObj.keyColumn = keyColumnId;
                guildDataObj.valueColumn = valueColumnId;

                await message.reply(`CSVファイルを読み込みました。\n成功: ${successCount}件、エラー: ${errorCount}件\nKey列: ${keyColumnId}、Value列: ${valueColumnId}`);
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
            statusMsg += `チャンネル: ${guildDataObj.channelId ? `<#${guildDataObj.channelId}>` : '未設定'}\n`;
            statusMsg += `CSVデータ: ${guildDataObj.csvData ? `${guildDataObj.csvData.size}件` : '未設定'}\n`;
            
            if (guildDataObj.keyColumn !== null && guildDataObj.valueColumn !== null) {
                statusMsg += `Key列: ${guildDataObj.keyColumn}、Value列: ${guildDataObj.valueColumn}\n`;
            }

            await message.reply(statusMsg);
        } else if (command === 'help') {
            const helpMsg = `
**SortingHat Bot コマンド一覧** (管理者のみ)

\`!setchannel\` - 現在のチャンネルをロール付与チャンネルに設定
\`!uploadcsv <KeyColumnId> <ValueColumnId>\` - CSVファイルをアップロードしてKey-Valueマッピングを設定
  例: \`!uploadcsv 0 1\` (0列目がロール名、1列目がユーザーが入力する値)
\`!status\` - 現在の設定を表示
\`!help\` - このヘルプメッセージを表示

**使い方:**
1. \`!setchannel\` でロール付与を行うチャンネルを設定
2. \`!uploadcsv 0 1\` でCSVファイルをアップロード (ロール名とマッチング値を指定)
3. ユーザーが設定したチャンネルでマッチング値を投稿するとロールが付与されます
4. 投稿されたメッセージは自動的に削除されます
            `;
            await message.reply(helpMsg);
        }
    }
});

// Login to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);
