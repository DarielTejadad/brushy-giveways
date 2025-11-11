// Añade esta línea al principio
global.WebSocket = require('ws');

const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ms = require('ms');

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ] 
});

// Configuración
const CONFIG = {
  giveawayChannelId: '1437620678034460906', // Canal donde se enviarán los sorteos
  staffRoleId: 'ID_DEL_ROL_STAFF', // Reemplaza con tu rol de staff
  ticketCategoryId: 'ID_CATEGORIA_TICKETS', // Reemplaza con la categoría de tickets
  staffRoles: [
    '1437618918997884968', // Rol de staff 1
    '1437623026911805511', // Rol de staff 2
    '1437623029634175047'  // Rol de staff 3
  ]
};

// Almacenamiento de sorteos activos
const activeGiveaways = new Map();

client.on('ready', () => {
  console.log(`✅ Bot Giveaways conectado como ${client.user.tag}`);
  
  // Registrar comandos slash
  const giveawayCommand = new SlashCommandBuilder()
    .setName('givaways')
    .setDescription('Gestión de sorteos (solo staff)')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Crea un nuevo sorteo')
        .addStringOption(option =>
          option.setName('duration')
            .setDescription('Duración del sorteo (ej: 1h, 30m, 2d)')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('premios')
            .setDescription('Descripción de los premios')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option.setName('ganadores')
            .setDescription('Número de ganadores')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10)
        )
        .addChannelOption(option =>
          option.setName('canal')
            .setDescription('Canal donde se realizará el sorteo (opcional)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('announcement')
        .setDescription('Anuncia los ganadores de un sorteo')
        .addStringOption(option =>
          option.setName('message_id')
            .setDescription('ID del mensaje del sorteo')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('ganadores')
            .setDescription('Ganadores del sorteo (separados por comas o @menciones)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('end')
        .setDescription('Finaliza un sorteo antes de tiempo')
        .addStringOption(option =>
          option.setName('message_id')
            .setDescription('ID del mensaje del sorteo')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('Muestra todos los sorteos activos')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reroll')
        .setDescription('Vuelve a sortear entre los participantes')
        .addStringOption(option =>
          option.setName('message_id')
            .setDescription('ID del mensaje del sorteo')
            .setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
  
  client.application.commands.set([giveawayCommand])
    .then(() => console.log('✅ Comando /givaways registrado'))
    .catch(console.error);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  
  if (interaction.commandName === 'givaways') {
    const subcommand = interaction.options.getSubcommand();
    
    // Verificar si el usuario tiene permisos de staff
    const hasStaffRole = interaction.member.roles.cache.some(role => 
      CONFIG.staffRoles.includes(role.id)
    );
    
    if (!hasStaffRole) {
      return interaction.reply({
        content: '❌ Este comando solo está disponible para el staff.',
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF0000)
            .setDescription('Necesitas un rol de staff para usar este comando.')
        ],
        ephemeral: true
      });
    }
    
    try {
      switch (subcommand) {
        case 'create':
          await createGiveaway(interaction);
          break;
        case 'announcement':
          await announceWinners(interaction);
          break;
        case 'end':
          await endGiveaway(interaction);
          break;
        case 'list':
          await listGiveaways(interaction);
          break;
        case 'reroll':
          await rerollGiveaway(interaction);
          break;
      }
    } catch (error) {
      console.error('Error en la interacción:', error);
      
      // Si la interacción no ha sido respondida, responder con un error
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ Ocurrió un error al procesar tu solicitud. Por favor, inténtalo más tarde.',
          ephemeral: true
        });
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({
          content: '❌ Ocurrió un error al procesar tu solicitud. Por favor, inténtalo más tarde.'
        });
      }
    }
  }
  
  // Manejar clics en botones de participación
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('giveaway_join_')) {
      try {
        await joinGiveaway(interaction);
      } catch (error) {
        console.error('Error en el botón de participación:', error);
        
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ Ocurrió un error al unirte al sorteo. Por favor, inténtalo más tarde.',
            ephemeral: true
          });
        }
      }
    }
  }
});

// Función para crear un sorteo
async function createGiveaway(interaction) {
  // Usar deferReply para evitar timeout
  await interaction.deferReply({ ephemeral: true });
  
  const duration = interaction.options.getString('duration');
  const prizes = interaction.options.getString('premios');
  const winnersCount = interaction.options.getInteger('ganadores');
  const channel = interaction.options.getChannel('canal') || await client.channels.fetch(CONFIG.giveawayChannelId);
  
  try {
    // Convertir duración a milisegundos
    const durationMs = ms(duration);
    if (!durationMs) {
      return await interaction.editReply({
        content: '❌ Duración inválida. Usa formatos como: 1h, 30m, 2d'
      });
    }
    
    // Crear embed del sorteo
    const giveawayEmbed = new EmbedBuilder()
      .setTitle('🎉 ¡NUEVO SORTEO! 🎉')
      .setDescription(`**Premios:** ${prizes}`)
      .addFields(
        { name: '⏰ Tiempo restante', value: `<t:${Math.floor((Date.now() + durationMs) / 1000)}:R>`, inline: true },
        { name: '🏆 Ganadores', value: `${winnersCount}`, inline: true },
        { name: '👥 Participantes', value: '0', inline: true }
      )
      .setColor(0x00AE86)
      .setFooter({ text: `Sorteo creado por ${interaction.user.tag}` })
      .setTimestamp();
    
    // Crear botón de participación
    const joinButton = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`giveaway_join_${Date.now()}`)
          .setLabel('🎉 Participar')
          .setStyle(ButtonStyle.Success)
      );
    
    // Enviar mensaje del sorteo
    const giveawayMessage = await channel.send({
      embeds: [giveawayEmbed],
      components: [joinButton]
    });
    
    // Guardar información del sorteo
    const giveawayId = giveawayMessage.id;
    activeGiveaways.set(giveawayId, {
      messageId: giveawayId,
      channelId: channel.id,
      prizes,
      winnersCount,
      endTime: Date.now() + durationMs,
      participants: [],
      hostId: interaction.user.id,
      guildId: interaction.guild.id
    });
    
    // Confirmación
    await interaction.editReply({
      content: `✅ Sorteo creado correctamente en ${channel}`
    });
    
    // Programar finalización del sorteo
    setTimeout(async () => {
      await endGiveawayAutomatically(giveawayId);
    }, durationMs);
    
    console.log(`✅ Sorteo creado: ${giveawayId}`);
    
  } catch (error) {
    console.error('Error al crear sorteo:', error);
    await interaction.editReply({
      content: '❌ Ocurrió un error al crear el sorteo. Por favor, inténtalo más tarde.'
    });
  }
}

// Función para unirse a un sorteo
async function joinGiveaway(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  const giveawayId = interaction.customId.split('_')[2];
  const giveaway = activeGiveaways.get(giveawayId);
  
  if (!giveaway) {
    return await interaction.editReply({
      content: '❌ Este sorteo ya ha finalizado o no existe.'
    });
  }
  
  // Verificar si el usuario ya participa
  if (giveaway.participants.includes(interaction.user.id)) {
    return await interaction.editReply({
      content: '❌ Ya estás participando en este sorteo.'
    });
  }
  
  // Añadir participante
  giveaway.participants.push(interaction.user.id);
  activeGiveaways.set(giveawayId, giveaway);
  
  // Actualizar mensaje del sorteo
  await updateGiveawayMessage(giveawayId);
  
  await interaction.editReply({
    content: '✅ ¡Te has unido al sorteo correctamente!'
  });
}

// Función para actualizar el mensaje del sorteo
async function updateGiveawayMessage(giveawayId) {
  const giveaway = activeGiveaways.get(giveawayId);
  if (!giveaway) return;
  
  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    const message = await channel.messages.fetch(giveaway.messageId);
    
    const updatedEmbed = new EmbedBuilder(message.embeds[0].data)
      .spliceFields(2, 1, { name: '👥 Participantes', value: `${giveaway.participants.length}`, inline: true });
    
    await message.edit({ embeds: [updatedEmbed] });
  } catch (error) {
    console.error('Error al actualizar mensaje del sorteo:', error);
  }
}

// Función para anunciar ganadores manualmente
async function announceWinners(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  const messageId = interaction.options.getString('message_id');
  const winnersInput = interaction.options.getString('ganadores');
  
  try {
    const channel = await client.channels.fetch(interaction.channelId);
    const message = await channel.messages.fetch(messageId);
    
    if (!message) {
      return await interaction.editReply({
        content: '❌ No se encontró el mensaje del sorteo.'
      });
    }
    
    // Procesar los ganadores (pueden ser menciones o IDs)
    const winners = [];
    const winnerMentions = winnersInput.match(/<@!?(\d+)>/g) || [];
    
    for (const mention of winnerMentions) {
      const userId = mention.match(/(\d+)/)[1];
      try {
        const user = await client.users.fetch(userId);
        winners.push(user);
      } catch (error) {
        console.error(`No se pudo encontrar el usuario con ID ${userId}:`, error);
      }
    }
    
    if (winners.length === 0) {
      return await interaction.editReply({
        content: '❌ No se encontraron usuarios válidos. Usa menciones como @usuario.'
      });
    }
    
    // Crear embed de anuncio
    const announcementEmbed = new EmbedBuilder()
      .setTitle('🏆 ¡GANADORES DEL SORTEO! 🏆')
      .setDescription(`¡Felicidades a los ganadores del sorteo!`)
      .addFields(
        { name: '🎁 Premios', value: message.embeds[0].description.split('**Premios:** ')[1] || 'Premios no especificados', inline: false },
        { name: '🏆 Ganadores', value: winners.map(w => `${w}`).join(', '), inline: false }
      )
      .setColor(0xFFD700)
      .setFooter({ text: `Anunciado por ${interaction.user.tag}` })
      .setTimestamp();
    
    await channel.send({ embeds: [announcementEmbed] });
    
    // Crear tickets para cada ganador
    await createTicketsForWinners(winners, message.embeds[0].description.split('**Premios:** ')[1] || 'Premios no especificados');
    
    await interaction.editReply({
      content: '✅ Ganadores anunciados correctamente.'
    });
    
  } catch (error) {
    console.error('Error al anunciar ganadores:', error);
    await interaction.editReply({
      content: '❌ Ocurrió un error al anunciar los ganadores.'
    });
  }
}

// Función para finalizar un sorteo automáticamente
async function endGiveawayAutomatically(giveawayId) {
  const giveaway = activeGiveaways.get(giveawayId);
  if (!giveaway) return;
  
  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    const message = await channel.messages.fetch(giveaway.messageId);
    
    if (giveaway.participants.length === 0) {
      // No hay participantes
      const noWinnersEmbed = new EmbedBuilder()
        .setTitle('😞 Sorteo Finalizado Sin Participantes')
        .setDescription('Este sorteo ha finalizado sin participantes.')
        .setColor(0xFF0000)
        .setTimestamp();
      
      await message.edit({ embeds: [noWinnersEmbed], components: [] });
      activeGiveaways.delete(giveawayId);
      return;
    }
    
    // Seleccionar ganadores aleatorios
    const winners = [];
    const participantsCopy = [...giveaway.participants];
    
    for (let i = 0; i < Math.min(giveaway.winnersCount, participantsCopy.length); i++) {
      const randomIndex = Math.floor(Math.random() * participantsCopy.length);
      const winnerId = participantsCopy.splice(randomIndex, 1)[0];
      winners.push(await client.users.fetch(winnerId));
    }
    
    // Crear embed de ganadores
    const winnersEmbed = new EmbedBuilder()
      .setTitle('🏆 ¡GANADORES DEL SORTEO! 🏆')
      .setDescription(`¡Felicidades a los ganadores!`)
      .addFields(
        { name: '🎁 Premios', value: giveaway.prizes, inline: false },
        { name: '🏆 Ganadores', value: winners.map(w => `${w}`).join(', '), inline: false },
        { name: '👥 Participantes totales', value: `${giveaway.participants.length}`, inline: true }
      )
      .setColor(0xFFD700)
      .setFooter({ text: 'Sorteo finalizado automáticamente' })
      .setTimestamp();
    
    await message.edit({ embeds: [winnersEmbed], components: [] });
    
    // Crear tickets para cada ganador
    await createTicketsForWinners(winners, giveaway.prizes);
    
    activeGiveaways.delete(giveawayId);
    console.log(`✅ Sorteo finalizado: ${giveawayId}`);
    
  } catch (error) {
    console.error('Error al finalizar sorteo automáticamente:', error);
  }
}

// Función para finalizar un sorteo manualmente
async function endGiveaway(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  const messageId = interaction.options.getString('message_id');
  const giveaway = Array.from(activeGiveaways.values()).find(g => g.messageId === messageId);
  
  if (!giveaway) {
    return await interaction.editReply({
      content: '❌ No se encontró un sorteo activo con ese ID de mensaje.'
    });
  }
  
  await endGiveawayAutomatically(giveaway.messageId);
  
  await interaction.editReply({
    content: '✅ Sorteo finalizado correctamente.'
  });
}

// Función para volver a sortear
async function rerollGiveaway(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  const messageId = interaction.options.getString('message_id');
  const giveaway = Array.from(activeGiveaways.values()).find(g => g.messageId === messageId);
  
  if (!giveaway) {
    return await interaction.editReply({
      content: '❌ No se encontró un sorteo activo con ese ID de mensaje.'
    });
  }
  
  if (giveaway.participants.length === 0) {
    return await interaction.editReply({
      content: '❌ No hay participantes en este sorteo.'
    });
  }
  
  // Seleccionar nuevos ganadores
  const newWinners = [];
  const participantsCopy = [...giveaway.participants];
  
  for (let i = 0; i < Math.min(giveaway.winnersCount, participantsCopy.length); i++) {
    const randomIndex = Math.floor(Math.random() * participantsCopy.length);
    const winnerId = participantsCopy.splice(randomIndex, 1)[0];
    newWinners.push(await client.users.fetch(winnerId));
  }
  
  // Crear embed de nuevos ganadores
  const newWinnersEmbed = new EmbedBuilder()
    .setTitle('🎲 ¡NUEVOS GANADORES! 🎲')
    .setDescription(`Se han seleccionado nuevos ganadores para el sorteo.`)
    .addFields(
      { name: '🎁 Premios', value: giveaway.prizes, inline: false },
      { name: '🏆 Nuevos ganadores', value: newWinners.map(w => `${w}`).join(', '), inline: false }
    )
    .setColor(0xFFD700)
    .setFooter({ text: `Reroll por ${interaction.user.tag}` })
    .setTimestamp();
  
  await interaction.editReply({ embeds: [newWinnersEmbed] });
  
  // Crear tickets para los nuevos ganadores
  await createTicketsForWinners(newWinners, giveaway.prizes);
}

// Función para listar sorteos activos
async function listGiveaways(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  if (activeGiveaways.size === 0) {
    return await interaction.editReply({
      content: '❌ No hay sorteos activos actualmente.'
    });
  }
  
  const listEmbed = new EmbedBuilder()
    .setTitle('🎉 Sorteos Activos')
    .setDescription(`Hay ${activeGiveaways.size} sorteos activos actualmente:`)
    .setColor(0x00AE86)
    .setTimestamp();
  
  for (const [giveawayId, giveaway] of activeGiveaways) {
    const timeLeft = giveaway.endTime - Date.now();
    const timeLeftFormatted = `<t:${Math.floor(giveaway.endTime / 1000)}:R>`;
    
    listEmbed.addFields({
      name: `Sorteo #${giveawayId.substring(0, 8)}`,
      value: `**Premios:** ${giveaway.prizes}\n**Ganadores:** ${giveaway.winnersCount}\n**Participantes:** ${giveaway.participants.length}\n**Tiempo restante:** ${timeLeftFormatted}`,
      inline: false
    });
  }
  
  await interaction.editReply({ embeds: [listEmbed] });
}

// Función para crear tickets para los ganadores
async function createTicketsForWinners(winners, prizes) {
  try {
    for (const winner of winners) {
      // Crear canal de ticket para el ganador
      const guild = await client.guilds.fetch(activeGiveaways.values().next().value.guildId);
      const ticketChannel = await guild.channels.create({
        name: `ticket-${winner.username}-${Date.now()}`,
        type: 0, // Text channel
        parent: CONFIG.ticketCategoryId,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: ['ViewChannel']
          },
          {
            id: winner.id,
            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
          },
          {
            id: client.user.id,
            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
          }
        ]
      });
      
      // Enviar mensaje de bienvenida al ticket
      const welcomeEmbed = new EmbedBuilder()
        .setTitle('🎉 ¡FELICIDADES! 🎉')
        .setDescription(`¡Felicidades ${winner}! Has ganado en nuestro sorteo.`)
        .addFields(
          { name: '🎁 Premio ganado', value: prizes, inline: false },
          { name: '📋 Siguientes pasos', value: 'Por favor, espera a que un miembro del staff se comunique contigo para coordinar la entrega de tu premio.', inline: false }
        )
        .setColor(0x00FF00)
        .setFooter({ text: 'Brush Studio | Sorteos' });
      
      await ticketChannel.send({ embeds: [welcomeEmbed] });
      
      // Notificar al staff
      const staffNotificationEmbed = new EmbedBuilder()
        .setTitle('🏆 Nuevo Ganador de Sorteo')
        .setDescription(`El usuario ${winner} ha ganado en el sorteo y se ha creado un ticket para coordinar la entrega.`)
        .addFields(
          { name: '🎁 Premio', value: prizes, inline: false },
          { name: '🎫 Ticket', value: ticketChannel.toString(), inline: false }
        )
        .setColor(0xFFD700)
        .setFooter({ text: 'Brush Studio | Sorteos' });
      
      // Enviar notificación al canal de staff
      const staffChannel = guild.channels.cache.get(CONFIG.giveawayChannelId);
      if (staffChannel) {
        await staffChannel.send({ embeds: [staffNotificationEmbed] });
      }
      
      console.log(`✅ Ticket creado para el ganador: ${winner.tag}`);
    }
  } catch (error) {
    console.error('Error al crear tickets para ganadores:', error);
  }
}

// Manejo de errores
client.on('error', error => {
  console.error('Error del bot:', error);
});

process.on('unhandledRejection', error => {
  console.error('Error no manejado:', error);
});

// Iniciar el bot
client.login(process.env.TOKEN);
