import { getDemoJerseyAssignments } from './demo-players';

export default function DemoJerseyAssignments({ assignedPlayers = [] }: {
  assignedPlayers?: ReadonlyArray<{ id: string; jersey: string }>;
}) {
  return <article className="managerCard">
    <h2>Camisetas de los 23 jugadores de prueba</h2>
    <p>Números precargados para probar el demo. Se respetan tus números personalizados. Esta lista de consulta no inscribe jugadores ni los declara presentes.</p>
    <table className="demoJerseyTable" aria-label="Camisetas asignadas a todos los jugadores ficticios">
      <thead><tr><th scope="col">Camiseta</th><th scope="col">Jugador</th><th scope="col">Cédula</th></tr></thead>
      <tbody>{getDemoJerseyAssignments(assignedPlayers).map((player) => <tr key={player.identificationNumber}>
        <th scope="row">#{player.jerseyNumber}</th>
        <td>{player.displayName}</td>
        <td>{player.identificationNumber}</td>
      </tr>)}</tbody>
    </table>
  </article>;
}
