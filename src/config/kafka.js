const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "auth-service",
  brokers: ["localhost:9092"], 
});

const producer = kafka.producer();

async function connectKafka() {
  try {
    await producer.connect();
    console.log("Auth Service connected to Kafka Broker");
  } catch (err) {
    console.error("Failed to connect to Kafka", err);
    process.exit(1); // Kill the server if it can't reach the broker
  }
}

module.exports = { producer, connectKafka };