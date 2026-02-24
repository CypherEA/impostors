async function run() {
    try {
        const response = await fetch(`https://rdap.org/domain/google.com`);
        const data = await response.json();
        console.log("RDAP Response:", JSON.stringify(data.events, null, 2));
    } catch (e) {
        console.error(e);
    }
}
run();
