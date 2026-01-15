import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { environment } from './config/constants';

const commands = [
  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your AMA wallet balance on Amadeus mainnet'),

  new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Get your wallet address for deposits'),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View your usage statistics and spending'),

  new SlashCommandBuilder()
    .setName('faucet')
    .setDescription('Claim 100 testnet AMA tokens (once per IP address)')
].map(command => command.toJSON());

// Register commands
const clientId = environment.DISCORD_CLIENT_ID;
const botToken = environment.DISCORD_BOT_TOKEN;

const rest = new REST({ version: '10' }).setToken(botToken);

(async () => {
  try {
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );

    console.log('✅ Slash commands registered');

  } catch (error) {
    console.error('❌ Error registering slash commands:', error);
  }
})();
